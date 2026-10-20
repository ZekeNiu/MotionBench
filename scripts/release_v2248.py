"""Risk-based 2.24.8 verification and exact-artifact delivery; legacy gates stay immutable."""
from pathlib import Path
import argparse, base64, datetime, hashlib, json, os, re, shutil, socket, subprocess, sys, time, urllib.request

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'scripts/release-v2248.json'
C = json.loads(CONFIG.read_text(encoding='utf-8'))
VERSION, DESKTOP, BASELINE = C['version'], C['desktopVersion'], C['baselineCommit']
CP = Path(C['checkpoint'])
OUT = ROOT / 'output/implementation-2.24.8/resumed'
ADAPTERS = OUT / 'adapters'
GUARD = 'cf0f3ca402aebbaf9fdefa7eb2e48eab489eea139d6387e2ccd3ed3013681f02'
PS = Path(os.environ.get('WINDIR', r'C:\Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
PWSH = Path(r'C:\Users\ZekeNiu\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe')
CHANGED_SOURCE = {'src/ringside-result-display.js', 'src/ringside-longitudinal.js', 'src/ringside-longitudinal-view.js', 'src/ringside-longitudinal.css'}
UNITS = ['comparison-trend-tests.cjs', 'longitudinal-model-tests.cjs', 'longitudinal-view-tests.cjs', 'longitudinal-display-state-tests.cjs', 'longitudinal-store-model-tests.cjs', 'evaluation-v220-model-tests.cjs', 'isometric-reference-model-tests.cjs', 'v2244-display-preservation-tests.cjs', 'comparison-assessment-v2248-tests.cjs']

def digest(file): return hashlib.sha256(Path(file).read_bytes()).hexdigest()
def read(file): return json.loads(Path(file).read_text(encoding='utf-8-sig'))
def require(value, message):
    if not value: raise AssertionError(message)
def git(*args): return subprocess.check_output(['git', *args], cwd=ROOT)
def write(file, value):
    file = Path(file); file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
def evidence(file):
    file = Path(file)
    return {'file': file.relative_to(ROOT).as_posix(), 'sha256': digest(file)}
def originals(file): return git('show', BASELINE + ':' + file)
def sources():
    return {p.relative_to(ROOT).as_posix(): digest(p) for folder in ('src', 'desktop', 'vendor') for p in sorted((ROOT / folder).rglob('*')) if p.is_file()}
def quote(value): return "'" + str(value).replace("'", "''") + "'"
def broker(file, args, style, receipt):
    command = '& ' + quote(ROOT / 'scripts/invoke-from-desktop.ps1') + ' -FilePath ' + quote(file) + ' -Arguments ' + quote(args) + ' -WorkingDirectory ' + quote(ROOT) + ' -WindowStyle ' + quote(style) + ' -ReceiptPath ' + quote(receipt)
    subprocess.run([str(PWSH), '-NoProfile', '-EncodedCommand', base64.b64encode(command.encode('utf-16le')).decode()], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
def wait_json(file):
    end = time.monotonic() + 60
    while time.monotonic() < end:
        try: return read(file)
        except (OSError, ValueError): time.sleep(.25)
    raise TimeoutError(str(file))

def adapter_text(kind):
    template = f'scripts/{dict(prepare="prepare", install="install", shortcut="check")[kind]}_v2247_{"shortcut" if kind == "shortcut" else "system"}.ps1'
    data = originals(template)
    require((ROOT / template).read_bytes() == data, 'Legacy template changed: ' + template)
    text = data.decode('utf-8').replace('2.24.7', VERSION).replace('2247', '2248')
    text = text.replace("$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))", '$workspace = ' + quote(ROOT))
    if kind == 'prepare':
        text = text.replace('f4f4fd40338726ad426ed1b323f31f6ea619d480', BASELINE)
    if kind == 'install':
        text = text.replace('python scripts/verify_v2248.py --require-candidate', 'python scripts/release_v2248.py verify --require-candidate')
        text = text.replace("(Join-Path $PSScriptRoot 'verify_v2248.py')", "(Join-Path $workspace 'scripts/release_v2248.py')")
    if kind == 'shortcut':
        text = text.replace("(Join-Path $PSScriptRoot 'invoke-from-desktop.ps1')", "(Join-Path $workspace 'scripts/invoke-from-desktop.ps1')")
    require('2.24.7' not in text and 'v2247' not in text, 'Adapter retained old identity')
    return template, data, text.encode('utf-8')

def adapters():
    ADAPTERS.mkdir(parents=True, exist_ok=True); result = {}
    for kind in ('prepare', 'install', 'shortcut'):
        template, original, data = adapter_text(kind); file = ADAPTERS / (kind + '.ps1')
        if file.exists(): require(file.read_bytes() == data, 'Preserve changed generated adapter: ' + str(file))
        else: file.write_bytes(data)
        result[kind] = {**evidence(file), 'template': template, 'templateSha256': hashlib.sha256(original).hexdigest()}
    write(ADAPTERS / 'identity.json', {'producerSha256': digest(__file__), 'baselineCommit': BASELINE, 'adapters': result})
    return result

def checkpoint():
    require(isinstance(C.get('manifestSha256'), str) and re.fullmatch('[0-9a-f]{64}', C['manifestSha256']), 'Bind the completed physical checkpoint before verification')
    require(digest(CP / 'manifest.json') == C['manifestSha256'], 'Physical checkpoint changed')
    item = read(CP / 'manifest.json')
    require(item['complete'] and item['kind'] == 'system-profile-checkpoint' and item['source']['virtualized'] is False and item['source']['parentName'] == 'explorer.exe' and item['sourceCommit'] == BASELINE, 'Invalid physical checkpoint')
    require(item['runnerSha256'] == adapters()['prepare']['sha256'], 'Checkpoint producer differs')
    require(item['source']['profile'] == r'C:\Users\ZekeNiu\AppData\Roaming\MotionBench Desktop', 'Wrong actual profile')
    for folder, entries in [('system-userdata', item['files']), ('program', item['programReference']['files'])]:
        target = (CP / folder).resolve()
        for e in entries:
            file = (target / e['path']).resolve()
            require(file.is_relative_to(target) and digest(file) == e['sha256'] and file.stat().st_size == e['bytes'], 'Physical backup bytes differ')
    return item

def bind_checkpoint():
    require(C['manifestSha256'] is None, 'Preserve the pinned checkpoint identity')
    item = read(CP / 'manifest.json'); receipt = read(OUT / 'checkpoint-complete.json')
    require(receipt['pass'] and receipt['manifestSha256'] == digest(CP / 'manifest.json'), 'No completed physical checkpoint receipt')
    C['manifestSha256'] = digest(CP / 'manifest.json')
    checkpoint()  # All paths, bytes and producer checks precede persisting the identity.
    write(CONFIG, C)
    print(json.dumps({'pass': True, 'manifestSha256': C['manifestSha256']}))

def dispatch(kind):
    inventory = adapters(); script = ROOT / inventory[kind]['file']
    if kind != 'prepare': checkpoint()
    receipt = OUT / (kind + '-dispatch.json')
    broker(PS, '-NoProfile -ExecutionPolicy Bypass -File "' + str(script) + '"', 'Hidden', receipt)
    print(json.dumps({'dispatched': kind, 'receipt': str(receipt), 'completion': str(OUT / {'prepare': 'checkpoint-complete.json', 'install': 'system-installation.json', 'shortcut': 'shortcut-check.json'}[kind])}))

def run_system(mode):
    require(mode in ('installed', 'reopened'), 'Invalid actual launch mode'); checkpoint()
    require(read(OUT / 'system-installation.json')['pass'], 'No verified installation')
    directory = CP / 'verification' / mode; directory.mkdir(parents=True, exist_ok=True)
    require(not (directory / 'receipt.json').exists(), 'Preserve previous private evidence')
    before = directory / 'before-physical.json'
    broker(PS, f'-NoProfile -ExecutionPolicy Bypass -File "{ROOT / "scripts/inspect-system-profile.ps1"}" -Destination "{before}"', 'Hidden', directory / 'probe-launch.json')
    physical = wait_json(before)
    subprocess.run([str(PWSH), '-NoProfile', '-Command', f'$p=Get-Process -Id {int(physical["processId"])} -ErrorAction SilentlyContinue;if($p){{Wait-Process -Id $p.Id -Timeout 60 -ErrorAction Stop}};exit 0'], check=True, stdout=subprocess.DEVNULL)
    with socket.socket() as server: server.bind(('127.0.0.1', 0)); port = server.getsockname()[1]
    launch = directory / 'native-launch.json'
    broker(Path(r'D:\Application\Strength&Conditioning\MotionBench\MotionBench.exe'), f'--remote-debugging-port={port}', 'Normal', launch)
    end = time.monotonic() + 60
    while True:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version', timeout=2) as response: json.load(response)
            break
        except (OSError, ValueError):
            if time.monotonic() > end: raise TimeoutError('Actual desktop attachment unavailable')
            time.sleep(.25)
    subprocess.run(['node', 'tests/desktop-system-v2248' + ('-reopened' if mode == 'reopened' else '') + '.cjs', mode, '--cdp-port', str(port), '--launch-receipt', str(launch), '--physical-before', str(before)], cwd=ROOT, check=True)

def run(kind):
    require(read(ROOT / 'package.json')['version'] == VERSION, 'Build the intended version first')
    OUT.mkdir(parents=True, exist_ok=True)
    if kind == 'units':
        file = OUT / 'units/results.json'; require(not file.exists(), 'Preserve previous focused unit evidence')
        before, source = sources(), digest(ROOT / 'MotionBench.html')
        result = {'sourceHash': source, 'runnerSha256': digest(__file__), 'sourceFiles': before, 'suites': [], 'pass': False}
        for name in UNITS:
            test = ROOT / 'tests' / name; initial = digest(test)
            execution = subprocess.run(['node', str(test)], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            output = execution.stdout.decode('utf-8', errors='replace'); log = OUT / 'units' / (name + '.log'); log.parent.mkdir(exist_ok=True); log.write_bytes(execution.stdout)
            passed = len(re.findall(r'^PASS(?:\s|$)', output, re.M))
            summary = re.search(r'^(\d+) [^\n]*checks passed(?:; (\d+) failed)?\s*$', output, re.M)
            if summary:
                require(not summary.group(2) or summary.group(2) == '0', 'Unit summary reports failures')
                passed = int(summary.group(1))
            result['suites'].append({'name': name, 'sha256': initial, 'exitCode': execution.returncode, 'checksPassed': passed, 'sourceUnchanged': digest(test) == initial, 'log': evidence(log)})
            write(file, result); print(name, execution.returncode, passed, flush=True)
            require(execution.returncode == 0 and initial == digest(test) and passed > 0, 'Focused unit failed; inspect saved log')
        result['sourceUnchanged'] = source == digest(ROOT / 'MotionBench.html') and before == sources()
        result['pass'] = result['sourceUnchanged']; write(file, result); require(result['pass'], 'Source changed during unit checks')
        return
    matrix = {'browser': ('comparison-assessment-v2248-browser-tests.cjs', ['--artifact-dir=' + str(OUT / 'focused')]), 'interaction': ('comparison-trend-interaction-tests.cjs', ['--artifact-dir=' + str(OUT / 'interaction')]), 'native': ('longitudinal-browser-tests.cjs', ['--desktop', '--artifact-dir', str(OUT / 'native')])}
    runner, args = matrix[kind]; directory = OUT / ('focused' if kind == 'browser' else kind)
    require(not (directory / 'results.json').exists(), 'Preserve previous focused evidence')
    env = os.environ.copy()
    if kind == 'native': env['MOTIONBENCH_EXECUTABLE'] = str(ROOT / 'dist-desktop/win-unpacked/MotionBench.exe')
    subprocess.run(['node', str(ROOT / 'tests' / runner), *args], cwd=ROOT, env=env, check=True)

def inherited(ci=False):
    """Reuse accepted behavior only where every protected runtime byte is unchanged."""
    previous = ROOT / 'docs/acceptance-2.24.7.json'
    require(previous.read_bytes() == originals('docs/acceptance-2.24.7.json'), 'Legacy acceptance changed')
    proof = read(previous); require(proof['pass'] and proof['privateVerified'], 'No complete accepted baseline')
    baseline_html = hashlib.sha256(originals('MotionBench.html')).hexdigest()
    require(proof['sourceHash'] == baseline_html, 'Legacy source and receipt differ')
    receipt_files = []
    def verify_old(value):
        if isinstance(value, dict):
            if isinstance(value.get('file'), str) and value.get('sha256'):
                if (ROOT / value['file']).exists():
                    require(digest(ROOT / value['file']) == value['sha256'], 'Inherited receipt changed: ' + value['file'])
                    receipt_files.append(value)
                else: require(ci, 'Inherited local receipt missing: ' + value['file'])
            for member in value.values(): verify_old(member)
        elif isinstance(value, list):
            for member in value: verify_old(member)
    verify_old(proof)
    protected = git('ls-tree', '-r', '--name-only', BASELINE, '--', 'src', 'desktop', 'vendor', 'body-map-front.png', 'scripts/build.py', 'tests/helpers').decode('utf-8').splitlines()
    files, changed = [], []
    for name in protected:
        baseline = hashlib.sha256(originals(name)).hexdigest(); current = digest(ROOT / name)
        if name in CHANGED_SOURCE:
            changed.append({'file': name, 'baselineSha256': baseline, 'sha256': current})
        else:
            require(current == baseline, 'Expand verification for changed protected code: ' + name)
            files.append({'file': name, 'sha256': current})
    for folder in ('src', 'desktop', 'vendor', 'tests/helpers'):
        tracked = set(git('ls-files', '--', folder).decode('utf-8').splitlines())
        require(tracked <= set(protected), 'New protected runtime/helper file requires scope review')
    allowed_root = {'MotionBench.html', 'package.json', 'package-lock.json', 'electron-builder.yml', 'README.md', '.github/workflows/comparison-windows.yml'} | CHANGED_SOURCE
    changed_paths = git('diff', '--name-only', BASELINE).decode('utf-8').splitlines()
    require(all(name in allowed_root or name.startswith(('tests/', 'docs/', 'scripts/')) for name in changed_paths), 'Unreviewed changed path outside release scope')
    for name in ('package.json', 'package-lock.json'):
        old, new = json.loads(originals(name)), read(ROOT / name)
        old.pop('version', None); new.pop('version', None)
        if name == 'package-lock.json':
            old.get('packages', {}).get('', {}).pop('version', None); new.get('packages', {}).get('', {}).pop('version', None)
        require(old == new, 'Dependency or package configuration changed')
    builder = (ROOT / 'electron-builder.yml').read_bytes().replace(DESKTOP.encode(), b'2.24.7-desktop.1').replace(VERSION.encode(), b'2.24.7')
    require(builder == originals('electron-builder.yml'), 'Desktop packaging configuration changed beyond version metadata')
    return {'commit': BASELINE, 'acceptance': evidence(previous), 'sourceHash': baseline_html,
            'inheritedOnly': True, 'notRunAgain': ['full 64-suite matrix', 'cross-browser full report matrix', 'full native PDF', 'generic 16-check desktop smoke'],
            'unchangedFiles': files, 'changedDisplayFiles': changed, 'verifiedPriorReceipts': len(receipt_files), 'cleanCI': ci,
            'meaning': 'Earlier accepted behavior is inherited only for identical protected code; these are not fresh 2.24.8 executions.'}

def receipt(file, producer, source, count):
    item = read(file)
    require(item.get('pass') and item.get('sourceHash', item.get('identity', {}).get('runtimeHtmlSha256')) == source, 'Receipt/source failed: ' + str(file))
    require(not item.get('errors') and not item.get('error') and not item.get('failure'), 'Receipt contains errors')
    require(item.get('runnerSha256', item.get('identity', {}).get('runnerSha256')) == digest(ROOT / producer), 'Producer changed: ' + producer)
    require(len(item['checks']) == count, 'Focused check inventory differs: ' + producer)
    for name, checksum in {**item.get('moduleHashes', {}), **item.get('sourceFiles', {})}.items(): require(digest(ROOT / name) == checksum, 'Focused source changed: ' + name)
    if 'fixtureSha256' in item: require(item['fixtureSha256'] == digest(ROOT / 'tests/helpers/longitudinal-fixture.cjs'), 'Fixture changed')
    for asset in item.get('artifacts', []):
        if asset.get('file') and asset.get('sha256'): require(digest(ROOT / asset['file']) == asset['sha256'], 'Focused artifact changed')
    return {**evidence(file), 'checks': count}, item

def public(ci=False):
    source = digest(ROOT / 'MotionBench.html'); require(read(ROOT / 'package.json')['version'] == VERSION, 'Wrong source version')
    reuse = inherited(ci); unit_file = OUT / 'units/results.json'; unit = read(unit_file)
    require(unit['pass'] and unit['sourceUnchanged'] and unit['sourceHash'] == source and unit['runnerSha256'] == digest(__file__), 'Focused unit producer/source differs')
    require([s['name'] for s in unit['suites']] == UNITS, 'Wrong focused unit inventory')
    for name, checksum in unit['sourceFiles'].items(): require(digest(ROOT / name) == checksum, 'Unit source changed: ' + name)
    for suite in unit['suites']:
        require(suite['exitCode'] == 0 and suite['sourceUnchanged'] and suite['checksPassed'] > 0 and suite['sha256'] == digest(ROOT / 'tests' / suite['name']), 'Focused unit failed/changed')
        require(digest(ROOT / suite['log']['file']) == suite['log']['sha256'], 'Unit log changed')
    browsers = {}
    browsers['focused'], focused = receipt(OUT / 'focused/results.json', 'tests/comparison-assessment-v2248-browser-tests.cjs', source, 6)
    require(1 <= focused['pdfPageCount'] <= 5 and focused['pdfDiagnostics']['status'] == 'complete', 'Focused PDF missing or larger than intended scope')
    browsers['interaction'], _ = receipt(OUT / 'interaction/results.json', 'tests/comparison-trend-interaction-tests.cjs', source, 3)
    native, native_result = receipt(OUT / 'native/results.json', 'tests/longitudinal-browser-tests.cjs', source, 10)
    require(native_result['identity']['runtimeHtmlSha256'] == source and native_result['identity']['runtimeMatchesSourceHtml'] and native_result['identity'] == native_result['finalIdentity'], 'Native tested package identity differs')
    require(native_result.get('sourceUnchanged'), 'Native source changed')
    package_info = read(ROOT / 'output/desktop-package/package-check.json')
    require(package_info['version'] == DESKTOP and package_info['webVersion'] == VERSION and not package_info['directoryOnly'] and package_info['updaterConfigurationPresent'], 'Final runtime inventory differs')
    require(package_info['archiveSha256'] == digest(ROOT / 'dist-desktop/win-unpacked/resources/app.asar') == native_result['identity']['archiveSha256'], 'Accepted archive differs from built package')
    result = {'version': VERSION, 'desktopVersion': DESKTOP, 'sourceHash': source, 'pass': True, 'verificationStrategy': 'risk-based',
              'model': {**evidence(unit_file), 'suites': len(UNITS), 'checks': sum(s['checksPassed'] for s in unit['suites'])}, 'inheritedBaseline': reuse,
              'browsers': browsers, 'native': native, 'package': {'archiveSha256': package_info['archiveSha256'], 'assets': len(package_info['files'])},
              'userAccepted': False, 'scope': 'Targeted synthetic Chrome/PDF/interaction and packaged Electron. Original-library preservation is separately recorded. No physical printer/mobile or live-provider acceptance.'}
    if not ci:
        rebuild = read(OUT / 'build-verification.json'); require(rebuild['identical'] and rebuild['sourceHash'] == source, 'Final deterministic rebuild failed')
        result['rebuild'] = evidence(OUT / 'build-verification.json')
        qa = read(OUT / 'visual-qa.json'); require(qa['complete'] and qa['sourceHash'] == source and len(qa['pdfs']) == 1, 'Focused PDF review incomplete')
        for pdf in qa['pdfs']:
            require(1 <= pdf['pages'] <= 5 and digest(ROOT / pdf['path']) == pdf['sha256'] and pdf['contactsReviewed'] and pdf['manualReviewedPages'], 'Focused PDF identity/review differs')
            require(len(pdf['manualReviewedPages']) == pdf['pages'], 'Review all focused PDF pages')
            from pypdf import PdfReader
            require(len(PdfReader(ROOT / pdf['path']).pages) == pdf['pages'] == focused['pdfPageCount'], 'Actual PDF page inventory differs')
            require(len(pdf['renderedPages']) == pdf['pages'], 'Render every focused PDF page')
            for png in pdf['renderedPages']: require(digest(ROOT / png['path']) == png['sha256'], 'Focused PDF rendering changed')
        result['pdfReview'] = {**evidence(OUT / 'visual-qa.json'), 'pages': sum(p['pages'] for p in qa['pdfs']), 'documents': 1}
    if ci: result['fullCI'] = verify_full_ci(source)
    return result

def full_browser():
    """Run the unchanged legacy matrix only in explicitly requested full regression."""
    import run_v2247_browser as legacy
    legacy.BASE = OUT / 'ci/full-browser'
    subprocess.run(['node', 'tests/comparison-trend-browser-tests.cjs', '--artifact-dir=' + str(legacy.BASE / 'chrome')], cwd=ROOT, check=True)
    old_argv = sys.argv
    try:
        sys.argv = [str(ROOT / 'scripts/run_v2247_browser.py')]
        legacy.main()
    finally: sys.argv = old_argv

def verify_full_ci(source):
    """CI keeps broad regression; local delivery never requires these repeated runs."""
    file = OUT / 'ci/full-units/unit-results.json'; unit = read(file)
    require(unit['sourceUnchanged'] and unit['sourceHash'] == source and len(unit['suites']) == 64 and unit['runnerSha256'] == digest(ROOT / 'tests/run-unit-tests.cjs'), 'Full CI unit run incomplete')
    for name, checksum in unit['modules'].items(): require(digest(ROOT / 'src' / name) == checksum, 'Full CI module changed')
    for suite in unit['suites']: require(suite['exitCode'] == 0 and suite['sourceUnchanged'] and suite['sha256'] == digest(ROOT / 'tests' / suite['name']), 'Full CI unit failed')
    desktop = read(OUT / 'ci/desktop-unit/results.json')
    require(desktop['pass'] and desktop['sourceUnchanged'] and desktop['sourceHash'] == source and len(desktop['suites']) == 5 and desktop['runnerSha256'] == digest(ROOT / 'tests/run-desktop-unit-tests.cjs'), 'Full CI desktop module run incomplete')
    for name, checksum in desktop['runtimeHashes'].items(): require(digest(ROOT / name) == checksum, 'CI desktop runtime changed')
    for suite in desktop['suites']: require(suite['exitCode'] == 0 and suite['sha256'] == digest(ROOT / 'tests' / suite['name']), 'CI desktop unit changed')
    matrix = {'page-isolation': ('pdf-page-isolation-browser-tests.cjs', 2), 'chrome': ('comparison-trend-browser-tests.cjs', 11), 'edge': ('comparison-trend-browser-tests.cjs', 9), 'controls': ('longitudinal-controls-browser-tests.cjs', 13), 'layout': ('longitudinal-layout-v2244-tests.cjs', 7), 'layout-regression': ('longitudinal-layout-browser-tests.cjs', 13), 'followup': ('longitudinal-followup-browser-tests.cjs', 7), 'ai': ('longitudinal-ai-browser-tests.cjs', 11), 'interaction': ('longitudinal-interaction-browser-tests.cjs', 8), 'tooltip': ('comparison-trend-interaction-tests.cjs', 3), 'balance-pdf': ('comparison-trend-pdf-edgecases.cjs', 2), 'personal': ('report-v220-browser-tests.cjs', 6), 'app': ('longitudinal-browser-tests.cjs', 10), 'polish': ('comparison-polish-browser-tests.cjs', 8)}
    browsers = {}
    for name, (producer, count) in matrix.items():
        path = OUT / 'ci/full-browser' / name / ('chrome.json' if name == 'personal' else 'results.json')
        browsers[name], _ = receipt(path, 'tests/' + producer, source, count)
    native, item = receipt(OUT / 'ci/native-full/results.json', 'tests/longitudinal-browser-tests.cjs', source, 11)
    require(item['identity']['runtimeHtmlSha256'] == source, 'CI full native package differs')
    smoke_file = OUT / 'ci/native-smoke/results.json'; smoke = read(smoke_file)
    require(smoke['pass'] and not smoke['errors'] and len(smoke['checks']) == 16 and smoke['identity']['runtimeHtmlSha256'] == source and smoke['identity']['testScriptSha256'] == digest(ROOT / 'tests/desktop-smoke.cjs'), 'CI generic native smoke failed')
    return {'units': evidence(file), 'desktopUnit': evidence(OUT / 'ci/desktop-unit/results.json'), 'browsers': browsers, 'nativePDF': native, 'nativeSmoke': evidence(smoke_file)}

def private(result, complete):
    checkpoint(); stages = {}; baseline = read(CP / 'verification/baseline/receipt.json')
    inventory = adapters()
    for mode in (('baseline', 'candidate', 'installed', 'reopened') if complete else ('baseline', 'candidate')):
        folder = CP / 'verification' / mode; item = read(folder / 'receipt.json')
        entry = 'tests/desktop-system-v2248' + ('-reopened' if mode == 'reopened' else '') + '.cjs'
        require(item['pass'] and item['normalClose'] and not item['errors'] and not item['guard']['blocked'], 'Actual-library stage failed: ' + mode)
        require(item['runnerSha256'] == digest(ROOT / 'tests/desktop-system-v2248.cjs') and item['stageEntrySha256'] == digest(ROOT / entry) and item['guardSha256'] == GUARD and item['manifestSha256'] == C['manifestSha256'], 'Private producer/checkpoint differs')
        require(item['snapshotSha256'] == digest(folder / 'snapshot.json') and item['counts'] == baseline['counts'] and len(item['checks']) == (3 if mode == 'baseline' else 5), 'Private snapshot/count differs')
        if mode != 'baseline': require(item['runtimeHtmlSha256'] == result['sourceHash'] and item['archiveSha256'] == result['package']['archiveSha256'], 'Private package differs')
        stages[mode] = {'pass': True, 'checks': len(item['checks']), 'normalClose': True, 'receiptSha256': digest(folder / 'receipt.json')}
    result['private'] = {'stages': stages, 'counts': baseline['counts'], 'checkpointSha256': C['manifestSha256']}; result['privateVerified'] = complete
    if complete:
        install = read(OUT / 'system-installation.json')
        require(install['pass'] and install['version'] == DESKTOP and install['systemManifestSha256'] == C['manifestSha256'] and install['verifierSha256'] == digest(__file__) and install['runnerSha256'] == inventory['install']['sha256'], 'Installation gate identity changed')
        require(all(e['matchesTestedPackage'] for e in install['checks']) and len(install['checks']) == 2, 'Installed bytes differ')
        shortcut = read(OUT / 'shortcut-check.json')
        require(shortcut['pass'] and shortcut['normalStartup'] and shortcut['launchArgs'] == [] and shortcut['uia']['found'] and shortcut['window']['visible'], 'Ordinary shortcut failed')
        require(shortcut['sourceHash'] == result['sourceHash'] and shortcut['archiveSha256'] == result['package']['archiveSha256'] and shortcut['runnerSha256'] == inventory['shortcut']['sha256'], 'Shortcut package differs')
        result['installation'] = evidence(OUT / 'system-installation.json'); result['shortcut'] = evidence(OUT / 'shortcut-check.json')

def package():
    require(not git('status', '--porcelain').strip(), 'Commit final accepted source and documents first')
    proof = public(); private(proof, True)
    acceptance = ROOT / 'docs/acceptance-2.24.8.json'; recorded = read(acceptance)
    require(recorded == proof, 'Regenerate final acceptance after final evidence changes')
    commit = git('rev-parse', 'HEAD').decode().strip(); destination = ROOT / 'output/release' / VERSION
    destination.mkdir(parents=True, exist_ok=True); require(not (destination / 'build-provenance.json').exists(), 'Preserve existing staged delivery')
    names = ['MotionBench.html', f'dist-desktop/MotionBench-{DESKTOP}-Setup-x64.exe', f'dist-desktop/MotionBench-{DESKTOP}-Portable-x64.exe', f'dist-desktop/MotionBench-{DESKTOP}-Setup-x64.exe.blockmap', 'dist-desktop/desktop.yml', 'dist-desktop/win-unpacked/resources/app.asar', 'docs/acceptance-2.24.8.md', 'docs/acceptance-2.24.8.json']
    assets = []
    for name in names:
        file, output = ROOT / name, destination / Path(name).name; shutil.copyfile(file, output)
        require(digest(file) == digest(output), 'Staged bytes differ'); assets.append({'file': output.name, 'source': name, 'bytes': output.stat().st_size, 'sha256': digest(output)})
    setup = destination / f'MotionBench-{DESKTOP}-Setup-x64.exe'
    require(base64.b64encode(hashlib.sha512(setup.read_bytes()).digest()).decode() in (destination / 'desktop.yml').read_text(), 'Updater checksum differs')
    inputs = git('ls-files', '--', 'src', 'desktop', 'vendor', 'MotionBench.html', 'body-map-front.png', 'package.json', 'package-lock.json', 'electron-builder.yml', 'scripts', 'tests', '.github/workflows/comparison-windows.yml', 'docs/verification-strategy.md').decode('utf-8').splitlines()
    source_files = []
    for name in inputs:
        require((ROOT / name).read_bytes() == git('show', commit + ':' + name), 'Working input bytes differ from recorded commit')
        source_files.append({'file': name, 'bytes': (ROOT / name).stat().st_size, 'sha256': digest(ROOT / name)})
    provenance = {'version': VERSION, 'desktopVersion': DESKTOP, 'commit': commit, 'workingTree': [], 'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sourceHash': proof['sourceHash'], 'assets': assets, 'sourceFiles': source_files, 'verificationStrategy': 'risk-based', 'baselineCommit': BASELINE, 'generatedAdapters': adapters(), 'privateDataIncluded': False,
                  'buildNote': 'Runtime inputs and packaged HTML match final accepted source; binaries precede the final acceptance/documentation commit.'}
    write(destination / 'build-provenance.json', provenance)
    asset_names = [Path(name).name for name in names] + ['build-provenance.json']
    (destination / 'SHA256SUMS.txt').write_text(''.join(digest(destination / name) + '  ' + name + '\n' for name in asset_names), encoding='ascii')
    inventory = [{'file': name, 'bytes': (destination / name).stat().st_size, 'sha256': digest(destination / name)} for name in [*asset_names, 'SHA256SUMS.txt']]
    require(len(inventory) == 10, 'Wrong public asset allowlist'); write(OUT / 'release-assets.json', {'commit': commit, 'assets': inventory})
    print(json.dumps({'pass': True, 'commit': commit, 'assets': len(inventory), 'sourceHash': proof['sourceHash']}))

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('command', choices=['adapters', 'prepare', 'bind-checkpoint', 'install', 'shortcut', 'private', 'run', 'full-browser', 'verify', 'package'])
    parser.add_argument('kind', nargs='?'); parser.add_argument('--require-candidate', action='store_true'); parser.add_argument('--require-private', action='store_true'); parser.add_argument('--record', action='store_true'); parser.add_argument('--ci', action='store_true')
    args = parser.parse_args()
    if args.command == 'adapters': print(json.dumps(adapters()))
    elif args.command in ('prepare', 'install', 'shortcut'): dispatch(args.command)
    elif args.command == 'bind-checkpoint': bind_checkpoint()
    elif args.command == 'private':
        if args.kind in ('baseline', 'candidate'):
            checkpoint(); subprocess.run(['node', 'tests/desktop-system-v2248.cjs', args.kind], cwd=ROOT, check=True)
        else: run_system(args.kind)
    elif args.command == 'run': run(args.kind)
    elif args.command == 'full-browser': full_browser()
    elif args.command == 'verify':
        result = public(args.ci)
        if args.require_candidate or args.require_private: private(result, args.require_private)
        if args.record: write(ROOT / 'docs/acceptance-2.24.8.json', result)
        print(json.dumps({'pass': True, 'sourceHash': result['sourceHash'], 'privateVerified': result.get('privateVerified', False)}))
    elif args.command == 'package': package()

if __name__ == '__main__': main()
