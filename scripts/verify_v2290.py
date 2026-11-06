"""Verify the exact 2.29.0 report upgrade against its synthetic regression evidence."""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/release/2.29.0-local/acceptance'


def digest(file, algorithm='sha256'):
    result = hashlib.new(algorithm)
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def read(file):
    return json.loads(Path(file).read_text(encoding='utf-8-sig'))


def inspect_package(directory):
    # Read package/source bytes directly; never rebuild or refresh a receipt here.
    javascript = r"""
const fs=require('node:fs'),path=require('node:path'),asar=require('@electron/asar'),yaml=require('js-yaml'),crypto=require('node:crypto');
const directory=process.argv[1],archive=path.join(directory,'win-unpacked/resources/app.asar');
const extract=name=>asar.extractFile(archive,path.normalize(name));
const html=extract('MotionBench.html'),source=fs.readFileSync('MotionBench.html');
const marker=/window\.RingsideBuild=Object\.freeze\((\{[^\n]+\})\);/.exec(html.toString('utf8'));
const files=asar.listPackage(archive).map(name=>name.replace(/\\/g,'/').replace(/^\//,''))
 .filter(name=>!asar.statFile(archive,path.normalize(name)).files).sort();
const allowed=/^(?:package\.json|MotionBench\.html|desktop\/[a-z0-9-]+\.cjs|desktop\/assets\/motionbench\.(?:ico|png)|vendor\/[a-z0-9-]+\.LICENSE\.txt|vendor\/versions\.json)$/;
for(const name of files){if(name.startsWith('node_modules/'))continue;
 if(!allowed.test(name))throw Error('Unexpected packaged source asset: '+name);
 if(name!=='package.json'&&!extract(name).equals(fs.readFileSync(name)))throw Error('Packaged source differs: '+name);}
console.log(JSON.stringify({htmlIdentical:html.equals(source),htmlSha256:crypto.createHash('sha256').update(html).digest('hex'),build:marker?JSON.parse(marker[1]):null,
 package:JSON.parse(extract('package.json').toString('utf8')),files,
 builder:yaml.load(fs.readFileSync('electron-builder.yml','utf8')),
 updater:yaml.load(fs.readFileSync(path.join(directory,'desktop.yml'),'utf8')),
 appUpdater:yaml.load(fs.readFileSync(path.join(directory,'win-unpacked/resources/app-update.yml'),'utf8'))}));
"""
    completed = subprocess.run(['node', '-e', javascript, str(directory)], cwd=ROOT,
                               check=True, capture_output=True, encoding='utf-8')
    return json.loads(completed.stdout)


def package_evidence(source_hash, receipt_path):
    directory = ROOT / 'output/release/2.29.0-local/desktop'
    archive = directory / 'win-unpacked/resources/app.asar'
    receipt = read(receipt_path)
    assert receipt['version'] == '2.29.0-desktop.1' and receipt['webVersion'] == '2.29.0'
    assert receipt.get('directoryOnly') is False and receipt.get('updaterConfigurationPresent') is True
    archive_hash = digest(archive)
    assert archive_hash == receipt['archiveSha256'], 'Package receipt belongs to another ASAR'
    inspected = inspect_package(directory)
    assert inspected['htmlIdentical'] and inspected['htmlSha256'] == source_hash, 'Packaged HTML differs from the tested build'
    assert inspected['build']['version'] == '2.29.0'
    assert inspected['files'] == sorted(receipt['files']), 'ASAR inventory differs from the package receipt'
    package = read(ROOT / 'package.json')
    assert inspected['package']['name'] == package['name'] and inspected['package']['main'] == 'desktop/main.cjs'
    for metadata in [inspected['package'], inspected['builder']['extraMetadata']]:
        assert metadata['version'] == '2.29.0-desktop.1' and metadata['webVersion'] == '2.29.0'
    for key, expected in {'provider': 'github', 'owner': 'ZekeNiu', 'repo': 'MotionBench', 'channel': 'desktop'}.items():
        assert inspected['appUpdater'].get(key) == expected, 'Packaged updater identity differs: ' + key
    setup = directory / 'MotionBench-2.29.0-desktop.1-Setup-x64.exe'
    portable = directory / 'MotionBench-2.29.0-desktop.1-Portable-x64.exe'
    sources = [setup, Path(str(setup) + '.blockmap'), portable, directory / 'desktop.yml']
    assets = []
    for file in sources:
        assert file.is_file() and file.stat().st_size > 0, 'Missing or empty release asset: ' + file.name
        assets.append({'file': file.name, 'bytes': file.stat().st_size, 'sha256': digest(file),
                       'sha512': base64.b64encode(bytes.fromhex(digest(file, 'sha512'))).decode('ascii')})
    by_name = {item['file']: item for item in assets}
    updater = inspected['updater']
    installer = by_name[setup.name]
    assert updater['version'] == '2.29.0-desktop.1' and updater['path'] == setup.name
    assert updater['sha512'] == installer['sha512'] and len(updater['files']) == 1, 'Update installer SHA512 differs'
    entry = updater['files'][0]
    assert entry['url'] == setup.name and entry['size'] == installer['bytes'] and entry['sha512'] == installer['sha512'], 'Update installer URL, size or SHA512 differs'
    return {'archiveSha256': archive_hash, 'htmlSha256': inspected['htmlSha256'], 'assets': len(inspected['files']),
            'installerSha256': installer['sha256'], 'portableSha256': by_name[portable.name]['sha256'],
            'updaterSha256': by_name['desktop.yml']['sha256'], 'artifacts': assets}


def verify(require_ci=False):
    assert read(ROOT / 'package.json')['version'] == '2.29.0'
    source_hash = digest(ROOT / 'MotionBench.html')
    subprocess.run(['python', str(ROOT / 'scripts/build.py')], cwd=ROOT, check=True)
    assert digest(ROOT / 'MotionBench.html') == source_hash, 'Build changed the tested HTML'
    evidence = []

    def record(file, runner, minimum, suites=False, channel=None, modules=None):
        value = read(file)
        if modules is None:
            assert value.get('sourceHash', value.get('sourceSHA256', value.get('identity', {}).get('sourceHtmlSha256'))) == source_hash, str(file)
        else:
            actual_sources = value.get('sources', {})
            assert set(modules) <= set(actual_sources), 'Missing actual runtime source identities: ' + str(file)
            for name, expected in actual_sources.items():
                assert digest(ROOT / name) == expected, name
        assert value.get('runnerSha256', value.get('identity', {}).get('testScriptSha256')) == digest(ROOT / runner), runner
        assert not value.get('failure') and not value.get('error') and not value.get('errors'), str(file)
        assert value.get('sourceUnchanged') is True, 'Test inputs changed or were not verified: ' + str(file)
        for name, expected in value.get('sourceHashes', {}).items():
            assert digest(ROOT / name) == expected, name
        if channel:
            assert value.get('channel') == channel, str(file)
        rows = value['suites'] if suites else value['checks']
        assert len(rows) >= minimum, str(file)
        if suites:
            for row in rows:
                assert row['exitCode'] == 0 and row['sourceUnchanged'] is True, row['name']
                assert row['sha256'] == digest(ROOT / 'tests' / row['name']), row['name']
                if row.get('log'):
                    assert row['logSha256'] == digest(ROOT / row['log'])
            for name, expected in value.get('modules', {}).items():
                assert digest(ROOT / 'src' / name) == expected, name
            for name, expected in value.get('runtimeHashes', {}).items():
                assert digest(ROOT / name) == expected, name
        else:
            assert value.get('pass') is True, str(file)
        for key, dependency in [('fixtureSha256', 'tests/helpers/longitudinal-fixture.cjs'),
                                ('selectionUiHelperSha256', 'tests/helpers/report-selection-ui.cjs')]:
            if key in value:
                assert value[key] == digest(ROOT / dependency), dependency
        for item in value.get('artifacts', []):
            artifact = Path(item.get('path') or item.get('file'))
            if not artifact.is_absolute():
                artifact = ROOT / artifact
            assert digest(artifact) == item['sha256'], str(artifact)
            if 'bytes' in item:
                assert artifact.stat().st_size == item['bytes'], str(artifact)
        evidence.append({'file': file.relative_to(ROOT).as_posix(), 'sha256': digest(file), 'checks': len(rows)})
        return value

    required = {
        'report-navigation-state-tests.cjs', 'longitudinal-navigation-state-tests.cjs',
        'team-selection-model-tests.cjs', 'team-model-tests.cjs', 'team-comparison-model-tests.cjs',
        'team-comparison-view-tests.cjs', 'team-store-model-tests.cjs', 'report-selection-model-tests.cjs',
        'report-owner-model-tests.cjs', 'ordinary-save-model-tests.cjs', 'entry-session-save-model-tests.cjs',
        'report-appearance-model-tests.cjs', 'personal-report-appearance-tests.cjs', 'horizontal-appearance-model-tests.cjs',
        'horizontal-representative-model-tests.cjs', 'horizontal-difference-display-tests.cjs', 'horizontal-model-tests.cjs',
        'horizontal-async-model-tests.cjs', 'horizontal-view-controller-tests.cjs', 'horizontal-migration-proof-tests.cjs',
        'longitudinal-model-tests.cjs', 'longitudinal-view-tests.cjs', 'longitudinal-store-model-tests.cjs',
        'longitudinal-display-state-tests.cjs', 'comparison-trend-tests.cjs', 'pdf-metadata-model-tests.cjs',
        'none-evaluation-plan-model-tests.cjs', 'method-compatibility-model-tests.cjs', 'calculation-model-tests.cjs'}
    unit = record(OUT / 'unit-final/unit-results.json', 'tests/run-unit-tests.cjs', len(required), suites=True)
    assert required <= {row['name'] for row in unit['suites']}, 'Missing required report computation/save/selection suites'
    record(OUT / 'desktop-unit/results.json', 'tests/run-desktop-unit-tests.cjs', 5, suites=True)
    for channel in ['chrome', 'msedge']:
        nav = record(OUT / ('navigation-' + channel) / 'results.json', 'tests/report-navigation-browser-tests.cjs', 12, channel=channel)
        assert nav['fixtureSha256'] == digest(ROOT / 'tests/helpers/longitudinal-fixture.cjs')
        if channel == 'chrome':
            assert nav['pdfRequested'] and nav['pdfDiagnostics']['status'] == 'complete'
            assert any(item['kind'] == 'pdf' for item in nav['artifacts'])
        record(OUT / ('team-' + channel) / 'results.json', 'tests/team-browser-tests.cjs', 8, channel=channel)
        record(OUT / ('horizontal-refinement-' + channel) / 'result.json', 'tests/horizontal-refinement-browser-tests.cjs', 16, channel=channel)
        record(OUT / ('selection-edge-' + channel) / ('result-' + channel + '.json'), 'tests/report-selection-edge-cases-browser-tests.cjs', 9, channel=channel)
        surface = record(OUT / ('surface-' + channel) / 'results.json', 'tests/report-surface-browser-tests.cjs', 7, channel=channel)
        assert surface['fixtureSha256'] == digest(ROOT / 'tests/helpers/longitudinal-fixture.cjs')
        upgrade = record(OUT / ('upgrade-' + channel) / 'results.json', 'tests/report-upgrade-browser-tests.cjs', 8, channel=channel)
        if channel == 'chrome':
            pdfs = [item for item in upgrade['artifacts'] if str(item['path']).endswith('.pdf')]
            assert {Path(item['path']).stem for item in pdfs} >= {'personal-single', 'team-single', 'team-longitudinal', 'team-horizontal'}, 'Personal single and all three team PDF evidence required'
            for item in pdfs:
                assert item['diagnostics']['status'] == 'complete'
                for key in ['missingRows', 'duplicateRows', 'changedRows', 'missingCharts', 'duplicateCharts']:
                    assert item['diagnostics'][key] == [], 'Incomplete report PDF: ' + item['path']
        record(OUT / ('data-return-' + channel) / 'results.json', 'tests/report-data-return-browser-tests.cjs', 6, channel=channel)
        record(OUT / ('title-transaction-' + channel) / 'results.json', 'tests/report-title-transaction-browser-tests.cjs', 4, channel=channel)
        record(OUT / ('workflow-selection-' + channel) / 'results.json', 'tests/report-workflow-selection-browser-tests.cjs', 6, channel=channel,
               modules=['src/ringside-report-selection.js', 'src/ringside-team-selection.js', 'src/ringside-horizontal-setup.js',
                        'src/ringside-workflow.css', 'tests/helpers/playwright.cjs'])
        record(OUT / ('team-comparison-view-' + channel) / 'receipt.json', 'tests/team-comparison-view-browser-tests.cjs', 8, channel=channel,
               modules=['src/ringside-team.js', 'src/ringside-team-view.js', 'src/ringside-team-comparison-view.js', 'src/ringside-team.css',
                        'tests/helpers/longitudinal-fixture.cjs', 'tests/helpers/playwright.cjs'])

    baseline = 'cba44743a9a10c1e31563811958672664f5977a1'
    # This release intentionally changes calculations, navigation and report export.
    # Bind accepted production inputs to this receipt, without claiming they are unchanged.
    production_files = subprocess.check_output(['git', 'ls-files', 'src', 'desktop', 'vendor', 'scripts/build.py'], cwd=ROOT, text=True).splitlines()
    production_hashes = {name: digest(ROOT / name) for name in production_files}

    package_path = ROOT / 'output/release/2.29.0-local/package-check.json'
    package = package_evidence(source_hash, package_path)
    native_path = ROOT / 'output/release/2.29.0-local/native-smoke/results.json'
    native = read(native_path)
    assert native['pass'] and not native.get('failure') and not native.get('errors')
    assert len(native['checks']) >= 16
    assert native.get('artifactUnchanged') is True and not native.get('cleanupErrors')
    assert native['identity']['archiveSha256'] == package['archiveSha256']
    assert native['identity']['runtimeHtmlSha256'] == source_hash
    assert native['identity']['testScriptSha256'] == digest(ROOT / 'tests/desktop-smoke.cjs')
    for item in native['artifacts']:
        artifact = native_path.parent / item['path']
        assert digest(artifact) == item['sha256'] and artifact.stat().st_size == item['bytes'], str(artifact)
    evidence.append({'file': native_path.relative_to(ROOT).as_posix(), 'sha256': digest(native_path), 'checks': len(native['checks'])})
    if require_ci:
        ci = read(ROOT / 'output/release/2.29.0-local/ci-status.json')
        assert ci.get('pass') is True and ci.get('complete') is True
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        assert ci['commit'] == commit
        expected_ci = {('.github/workflows/horizontal-windows.yml', 'main'),
                       ('.github/workflows/horizontal-windows.yml', 'v2.29.0-desktop.1'),
                       ('.github/workflows/public-demo.yml', 'main')}
        actual_ci = set()
        for run in ci['runs']:
            key = (run.get('path'), run.get('headBranch', run.get('head_branch')))
            assert key not in actual_ci, 'Duplicate CI workflow identity'
            actual_ci.add(key)
            assert run.get('headSha', run.get('head_sha')) == commit
            assert run['status'] == 'completed' and run['conclusion'] == 'success'
        assert actual_ci == expected_ci, 'Exact main/tag Windows and main Public Demo runs required'
    result = {'pass': True, 'version': '2.29.0', 'desktopVersion': '2.29.0-desktop.1', 'sourceHash': source_hash,
              'unitSuites': len(unit['suites']), 'unitChecks': sum(row['checksPassed'] or sum(line.startswith('PASS ') for line in row.get('stdout', '').splitlines()) for row in unit['suites']),
              'evidence': evidence, 'package': package, 'packageReceiptSha256': digest(package_path),
              'baseline': baseline, 'productionSourceHashes': production_hashes, 'requiredUnitSuites': sorted(required), 'requiredCiChecked': require_ci}
    target = ROOT / 'output/release/2.29.0-local/verification.json'
    target.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-ci', action='store_true')
    verify(parser.parse_args().require_ci)
