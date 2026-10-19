"""Source-bound public and private acceptance for the 2.24.5 display release."""
from pathlib import Path
import argparse, hashlib, json

ROOT = Path(__file__).resolve().parents[1]
CP = Path(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261019-system-before-2.24.5')
MANIFEST = 'c1546340f776fdfaf6500a456ceaea2e92ed174b631972afabb1751f6158226b'
VERSION, DESKTOP = '2.24.5', '2.24.5-desktop.1'
def digest(file): return hashlib.sha256(Path(file).read_bytes()).hexdigest()
def read(file): return json.loads(Path(file).read_text(encoding='utf-8-sig'))
def require(ok, message):
    if not ok: raise AssertionError(message)
def evidence(relative): return {'file': relative, 'sha256': digest(ROOT / relative)}

def public(preinstall=False):
    source = digest(ROOT / 'MotionBench.html')
    require(read(ROOT / 'package.json')['version'] == VERSION, 'Source version differs')
    unit = read(ROOT / 'output/tests/v2.24.5/unit-results.json')
    require(unit['sourceHash'] == source and unit.get('sourceUnchanged') and len(unit['suites']) == 63, 'Full current model proof missing')
    require(unit['runnerSha256'] == digest(ROOT / 'tests/run-unit-tests.cjs'), 'Unit producer changed')
    for file, sha in unit['modules'].items(): require(digest(ROOT / 'src' / file) == sha, 'Unit module changed')
    for row in unit['suites']:
        require(row['exitCode'] == 0 and row['sourceUnchanged'] and row['sha256'] == digest(ROOT / 'tests' / row['name']), 'Model suite failed or changed')
    checks = sum(row['checksPassed'] for row in unit['suites'])
    require(checks == 1004, 'Model check inventory differs')
    desktop = read(ROOT / 'output/tests/v2.24.5/desktop-unit/results.json')
    require(desktop['pass'] and desktop['sourceHash'] == source and len(desktop['suites']) == 5 and desktop['runnerSha256'] == digest(ROOT / 'tests/run-desktop-unit-tests.cjs'), 'Desktop module proof missing')
    for row in desktop['suites']: require(row['exitCode'] == 0 and row['sha256'] == digest(ROOT / 'tests' / row['name']), 'Desktop module failed or changed')
    runners = {
        'layout': ('longitudinal-layout-v2244-tests.cjs', 8), 'layout-regression': ('longitudinal-layout-browser-tests.cjs', 13),
        'controls': ('longitudinal-controls-browser-tests.cjs', 14), 'app': ('longitudinal-browser-tests.cjs', 10),
        'personal': ('report-v220-browser-tests.cjs', 6), 'ai': ('longitudinal-ai-browser-tests.cjs', 11),
        'interaction': ('longitudinal-interaction-browser-tests.cjs', 8), 'followup': ('longitudinal-followup-browser-tests.cjs', 8)}
    if preinstall:
        # Installation requires all model/native/data-preservation checks plus
        # the layouts and new behavior. The full browser matrix gates publication.
        runners = {key: value for key, value in runners.items() if key in ('layout', 'layout-regression', 'followup')}
    browsers = {}
    for channel in ('chrome', 'msedge'):
        browsers[channel] = {}
        for kind, (runner, count) in runners.items():
            relative = f'output/playwright/v2245/{kind}/{channel}/' + (f'{channel}.json' if kind == 'personal' else 'results.json')
            item = read(ROOT / relative)
            require(item.get('pass') and not item.get('errors') and not item.get('failure') and not item.get('network'), 'Browser check failed: ' + relative)
            require(item['sourceHash'] == source and item['runnerSha256'] == digest(ROOT / 'tests' / runner) and len(item['checks']) == count, 'Browser producer/source/inventory differs: ' + relative)
            for file, sha in item.get('moduleHashes', {}).items(): require(digest(ROOT / file) == sha, 'Browser module changed')
            for entry in item.get('artifacts', []):
                if isinstance(entry, dict) and 'sha256' in entry:
                    relative_artifact = entry.get('file') or entry.get('path')
                    require(relative_artifact and digest(ROOT / relative_artifact) == entry['sha256'], 'Export artifact changed')
            browsers[channel][kind] = {**evidence(relative), 'checks': count}
    native_path = 'output/playwright/v2245/app/desktop/results.json'
    native = read(ROOT / native_path)
    require(native['pass'] and native['sourceHash'] == source and len(native['checks']) == 11 and not native.get('errors'), 'Packaged native comparison failed')
    require(native['identity']['runtimeHtmlSha256'] == source and native['runnerSha256'] == digest(ROOT / 'tests/longitudinal-browser-tests.cjs'), 'Native comparison source changed')
    for entry in native.get('artifacts', []): require(digest(ROOT / entry['file']) == entry['sha256'], 'Native export changed')
    package = read(ROOT / 'output/desktop-package/package-check.json')
    require(package['version'] == DESKTOP and package['webVersion'] == VERSION and len(package['files']) == 271 and not package['directoryOnly'] and package['updaterConfigurationPresent'], 'Packaged runtime identity differs')
    require(package['archiveSha256'] == digest(ROOT / 'dist-desktop/win-unpacked/resources/app.asar'), 'Packaged archive changed')
    return {'version': VERSION, 'desktopVersion': DESKTOP, 'sourceHash': source, 'pass': True,
            'model': {**evidence('output/tests/v2.24.5/unit-results.json'), 'suites': 63, 'checks': checks},
            'desktopUnit': {**evidence('output/tests/v2.24.5/desktop-unit/results.json'), 'suites': 5}, 'browsers': browsers,
            'native': {**evidence(native_path), 'checks': 11}, 'package': {'archiveSha256': package['archiveSha256'], 'assets': len(package['files'])}}

def private(result, complete):
    require(digest(CP / 'manifest.json') == MANIFEST, 'Immutable physical checkpoint changed')
    manifest = read(CP / 'manifest.json')
    require(manifest['complete'] and manifest['source']['parentName'] == 'explorer.exe' and manifest['source']['virtualized'] is False, 'Actual physical system backup missing')
    for folder, entries in [('system-userdata', manifest['files']), ('program', manifest['programReference']['files'])]:
        for entry in entries: require(digest(CP / folder / entry['path']) == entry['sha256'], 'Immutable original backup bytes changed')
    stages = {}
    for mode in (('baseline', 'candidate', 'installed', 'reopened') if complete else ('baseline', 'candidate')):
        item = read(CP / 'verification' / mode / 'receipt.json')
        require(item['pass'] and item['normalClose'] and item['manifestSha256'] == MANIFEST and not item['errors'], 'Private data/save/close check failed: ' + mode)
        runner = 'tests/desktop-system-v2245-reopened.cjs' if mode == 'reopened' else 'tests/desktop-system-v2245.cjs'
        require(item['runnerSha256'] == digest(ROOT / runner), 'Private producer changed')
        require(item['guardSha256'] == 'cf0f3ca402aebbaf9fdefa7eb2e48eab489eea139d6387e2ccd3ed3013681f02', 'Original data-protection rules changed')
        require(item['snapshotSha256'] == digest(CP / 'verification' / mode / 'snapshot.json'), 'Private reference snapshot changed')
        require(len(item['checks']) == (3 if mode == 'baseline' else 5) and item['counts'] == {'athletes': 2, 'records': 5} and not item['guard']['blocked'], 'Private inventory or data guard differs')
        if mode != 'baseline': require(item['runtimeHtmlSha256'] == result['sourceHash'] and item['archiveSha256'] == result['package']['archiveSha256'], 'Private runtime differs')
        stages[mode] = {'pass': True, 'checks': len(item['checks']), 'normalClose': True, 'receiptSha256': digest(CP / 'verification' / mode / 'receipt.json'), 'snapshotSha256': item['snapshotSha256']}
    result['private'] = stages
    result['privateVerified'] = complete
    if complete:
        install = read(ROOT / 'output/implementation-2.24.5/system-installation.json')
        require(install['pass'] and install['version'] == DESKTOP and install['systemManifestSha256'] == MANIFEST and install['verifierSha256'] == digest(ROOT / 'scripts/verify_v2245_preinstall.py'), 'Actual original-directory installation proof differs')
        require(install['runnerSha256'] == digest(ROOT / 'scripts/install_v2245_system.ps1') and all(row['matchesTestedPackage'] for row in install['checks']), 'Installed bytes differ from tested package')
        result['installation'] = {**evidence('output/implementation-2.24.5/system-installation.json'), 'originalDirectory': True}
        shortcut = read(ROOT / 'output/implementation-2.24.5/shortcut-check.json')
        require(shortcut.get('pass') is True and shortcut['sourceHash'] == result['sourceHash'] and shortcut['archiveSha256'] == result['package']['archiveSha256'] and shortcut['runnerSha256'] == digest(ROOT / 'scripts/check_v2245_shortcut.ps1'), 'Normal original shortcut proof missing')
        require(shortcut['normalStartup'] and shortcut['launchArgs'] == [] and shortcut['uia']['found'] and shortcut['window']['visible'], 'Ordinary visible shortcut startup did not pass')
        result['shortcut'] = evidence('output/implementation-2.24.5/shortcut-check.json')

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--ci', action='store_true'); parser.add_argument('--require-candidate', action='store_true'); parser.add_argument('--require-private', action='store_true'); parser.add_argument('--record', action='store_true'); args = parser.parse_args()
    result = public(preinstall=args.require_candidate and not args.require_private)
    if args.require_candidate or args.require_private: private(result, args.require_private)
    if not args.ci:
        smoke = read(ROOT / 'output/desktop-smoke-v2245/results.json')
        require(smoke['pass'] and len(smoke['checks']) == 16 and smoke['identity']['runtimeHtmlSha256'] == result['sourceHash'], 'Native desktop smoke incomplete')
        result['nativeSmoke'] = {**evidence('output/desktop-smoke-v2245/results.json'), 'checks': 16}
    if args.record: (ROOT / 'docs/acceptance-2.24.5.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'pass': True, 'version': VERSION, 'privateVerified': result.get('privateVerified', False), 'sourceHash': result['sourceHash']}))

if __name__ == '__main__': main()
