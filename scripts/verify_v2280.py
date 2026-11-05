"""Verify the exact 2.28.0 build against its synthetic regression evidence."""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/release/2.28.0-local/acceptance'


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
    directory = ROOT / 'output/release/2.28.0-local/desktop'
    archive = directory / 'win-unpacked/resources/app.asar'
    receipt = read(receipt_path)
    assert receipt['version'] == '2.28.0-desktop.1' and receipt['webVersion'] == '2.28.0'
    assert receipt.get('directoryOnly') is False and receipt.get('updaterConfigurationPresent') is True
    archive_hash = digest(archive)
    assert archive_hash == receipt['archiveSha256'], 'Package receipt belongs to another ASAR'
    inspected = inspect_package(directory)
    assert inspected['htmlIdentical'] and inspected['htmlSha256'] == source_hash, 'Packaged HTML differs from the tested build'
    assert inspected['build']['version'] == '2.28.0'
    assert inspected['files'] == sorted(receipt['files']), 'ASAR inventory differs from the package receipt'
    package = read(ROOT / 'package.json')
    assert inspected['package']['name'] == package['name'] and inspected['package']['main'] == 'desktop/main.cjs'
    for metadata in [inspected['package'], inspected['builder']['extraMetadata']]:
        assert metadata['version'] == '2.28.0-desktop.1' and metadata['webVersion'] == '2.28.0'
    for key, expected in {'provider': 'github', 'owner': 'ZekeNiu', 'repo': 'MotionBench', 'channel': 'desktop'}.items():
        assert inspected['appUpdater'].get(key) == expected, 'Packaged updater identity differs: ' + key
    setup = directory / 'MotionBench-2.28.0-desktop.1-Setup-x64.exe'
    portable = directory / 'MotionBench-2.28.0-desktop.1-Portable-x64.exe'
    sources = [setup, Path(str(setup) + '.blockmap'), portable, directory / 'desktop.yml']
    assets = []
    for file in sources:
        assert file.is_file() and file.stat().st_size > 0, 'Missing or empty release asset: ' + file.name
        assets.append({'file': file.name, 'bytes': file.stat().st_size, 'sha256': digest(file),
                       'sha512': base64.b64encode(bytes.fromhex(digest(file, 'sha512'))).decode('ascii')})
    by_name = {item['file']: item for item in assets}
    updater = inspected['updater']
    installer = by_name[setup.name]
    assert updater['version'] == '2.28.0-desktop.1' and updater['path'] == setup.name
    assert updater['sha512'] == installer['sha512'] and len(updater['files']) == 1, 'Update installer SHA512 differs'
    entry = updater['files'][0]
    assert entry['url'] == setup.name and entry['size'] == installer['bytes'] and entry['sha512'] == installer['sha512'], 'Update installer URL, size or SHA512 differs'
    return {'archiveSha256': archive_hash, 'htmlSha256': inspected['htmlSha256'], 'assets': len(inspected['files']),
            'installerSha256': installer['sha256'], 'portableSha256': by_name[portable.name]['sha256'],
            'updaterSha256': by_name['desktop.yml']['sha256'], 'artifacts': assets}


def verify(require_ci=False):
    assert read(ROOT / 'package.json')['version'] == '2.28.0'
    html = ROOT / 'MotionBench.html'
    source_hash = digest(html)
    subprocess.run(['python', str(ROOT / 'scripts/build.py')], cwd=ROOT, check=True)
    assert digest(html) == source_hash, 'Build changed the tested HTML'
    evidence = []

    def record(file, runner, minimum, suites=False, channel=None, modules_only=False, artifact_root=None):
        file = Path(file)
        value = read(file)
        if modules_only:
            assert value.get('sourceHashes'), 'Loaded module identities missing: ' + str(file)
        else:
            assert value.get('sourceHash', value.get('sourceSHA256', value.get('identity', {}).get('sourceHtmlSha256'))) == source_hash, str(file)
        assert value.get('runnerSha256', value.get('identity', {}).get('testScriptSha256')) == digest(ROOT / runner), runner
        if channel is not None:
            assert value.get('channel') == channel, 'Browser channel differs: ' + str(file)
        assert not value.get('failure') and not value.get('error') and not value.get('errors'), str(file)
        assert value.get('sourceUnchanged', True) is True, str(file)
        rows = value['suites'] if suites else value['checks']
        assert len(rows) >= minimum, str(file)
        if suites:
            assert value['sourceUnchanged'] is True
            for row in rows:
                assert row['exitCode'] == 0 and row['sourceUnchanged'] is True, row['name']
                assert row['sha256'] == digest(ROOT / 'tests' / row['name']), row['name']
                if row.get('log'):
                    assert row['logSha256'] == digest(ROOT / row['log']), row['log']
            for name, expected in value.get('modules', {}).items():
                assert digest(ROOT / 'src' / name) == expected, name
            for name, expected in value.get('runtimeHashes', {}).items():
                assert digest(ROOT / name) == expected, name
        else:
            assert value.get('pass') is True, str(file)
        for name, expected in {**value.get('identity', {}).get('sourceHashes', {}), **value.get('sourceHashes', {})}.items():
            assert digest(ROOT / name) == expected, name
        for item in value.get('artifacts', []):
            path = Path(item.get('path') or item.get('file'))
            if not path.is_absolute():
                path = (artifact_root or ROOT) / path
            assert digest(path) == item['sha256'], str(path)
            if 'bytes' in item:
                assert path.stat().st_size == item['bytes'], str(path)
        evidence.append({'file': file.relative_to(ROOT).as_posix(), 'sha256': digest(file), 'checks': len(rows)})
        return value

    def pdf_series(value, directory, surface=False):
        names = {'personal', 'longitudinal', 'horizontal'}
        items = value.get('pdf', [])
        field = 'kind' if surface else 'name'
        assert len(items) == 3 and {item[field] for item in items} == names, 'Incomplete PDF report kinds'
        artifacts = {(ROOT / (item.get('path') or item.get('file'))).resolve()
                     for item in value['artifacts']}
        for item in items:
            name = item[field]
            capture = directory / (name + ('-pdf-capture.json' if surface else '-capture.json'))
            assert capture.resolve() in artifacts and (directory / (name + '.pdf')).resolve() in artifacts
            data = read(capture)
            assert data['diagnostics']['status'] == 'complete'
            assert item['pages'] > 0 and len(data['pages']) == item['pages']
            if surface:
                assert item['captureSha256'] == digest(capture), str(capture)
            page_directory = directory / (name + '-pages' if surface else name)
            pages = sorted(page_directory.glob('page-*.png'))
            assert len(pages) == item['pages'] and all(page.resolve() in artifacts for page in pages)

    unit = record(OUT / 'unit-final/unit-results.json', 'tests/run-unit-tests.cjs', 85, True)
    record(OUT / 'desktop-unit/results.json', 'tests/run-desktop-unit-tests.cjs', 5, True)
    for channel in ['chrome', 'msedge']:
        record(OUT / ('methods-' + channel) / (channel + '-results.json'), 'tests/method-compatibility-browser-tests.cjs', 3, channel=channel)
        record(OUT / ('operation-' + channel) / (channel + '-results.json'), 'tests/operation-ui-browser-tests.cjs', 21, channel=channel)
        calc_directory = OUT / ('calculations-' + channel)
        calc = record(calc_directory / 'results.json', 'tests/calculation-browser-tests.cjs', 11, channel=channel)
        assert calc['fixtureSha256'] == digest(ROOT / 'tests/helpers/calculation-fixture.cjs')
        assert calc.get('pdfRequested') is True and len(calc.get('pdf', [])) >= 3
        pdf_series(calc, calc_directory)
        none = record(OUT / ('none-' + channel) / 'results.json', 'tests/none-evaluation-plan-browser-tests.cjs', 13, channel=channel)
        assert any(item.get('kind') == 'pdf' for item in none.get('artifacts', [])), 'None evaluation PDF missing'
        none_capture = OUT / ('none-' + channel) / 'none-personal-pdf-capture.json'
        none_artifacts = {item.get('path') or item.get('file') for item in none['artifacts']}
        assert none_capture.relative_to(ROOT).as_posix() in none_artifacts
        assert none_capture.with_name('none-personal.pdf').relative_to(ROOT).as_posix() in none_artifacts
        assert read(none_capture)['diagnostics']['status'] == 'complete'
        surface_directory = OUT / ('surface-' + channel)
        surface = record(surface_directory / 'results.json', 'tests/report-surface-browser-tests.cjs', 10, channel=channel)
        assert surface.get('pdfRequested') is True and surface.get('sourceUnchanged') is True
        assert len(surface.get('pdf', [])) >= 3
        pdf_series(surface, surface_directory, surface=True)
        assert surface['fixtureSha256'] == digest(ROOT / 'tests/helpers/longitudinal-fixture.cjs')
        assert surface['baselineHash'] == hashlib.sha256(subprocess.check_output(['git', 'show', '3ba6426:MotionBench.html'], cwd=ROOT)).hexdigest()

    for channel in ['chrome', 'msedge']:
        team = record(ROOT / 'output/playwright/team-report' / channel / 'results.json', 'tests/team-browser-tests.cjs', 9, channel=channel)
        assert team.get('pdfDiagnostics', {}).get('status') == 'complete', 'Team PDF did not complete'
        pdf = ROOT / 'output/playwright/team-report' / channel / 'team-report.pdf'
        assert pdf.stat().st_size > 10000 and digest(pdf) == team['pdfSha256']
        assert team['pdfPages'] and all(page['team'] == 'true' for page in team['pdfPages'])
        record(ROOT / 'output/playwright/team-view' / channel / 'receipt.json', 'tests/team-view-browser-tests.cjs', 13, channel=channel, modules_only=True)
        record(ROOT / 'output/playwright/team-storage' / ('result-' + channel + '.json'), 'tests/team-storage-browser-tests.cjs', 14, channel=channel, modules_only=True)
        record(ROOT / 'output/playwright/team-lifecycle' / ('result-' + channel + '.json'), 'tests/team-lifecycle-browser-tests.cjs', 9, channel=channel)

    package_path = ROOT / 'output/release/2.28.0-local/package-check.json'
    package = package_evidence(source_hash, package_path)
    native = record(ROOT / 'output/playwright/team-native/results.json', 'tests/team-native-tests.cjs', 7)
    assert native['archiveSha256'] == package['archiveSha256'], 'Team native receipt belongs to another package'
    for file, runner, minimum in [('output/release/2.28.0-local/native-smoke/results.json', 'tests/desktop-smoke.cjs', 16), ('output/horizontal-refinement/native-2.26.3/results.json', 'tests/horizontal-refinement-native-tests.cjs', 11)]:
        value = record(ROOT / file, runner, minimum, artifact_root=(ROOT / file).parent if runner == 'tests/desktop-smoke.cjs' else ROOT)
        assert value['identity']['archiveSha256'] == package['archiveSha256']
        assert value['identity']['runtimeHtmlSha256'] == source_hash
    record(ROOT / 'output/release/2.26.3-local/native-failure-tests/results.json', 'tests/native-runner-failure-tests.cjs', 2)
    if require_ci:
        ci = read(ROOT / 'output/release/2.28.0-local/ci-status.json')
        assert ci.get('pass') is True and ci.get('complete') is True
        assert ci['commit'] == subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    result = {'pass': True, 'version': '2.28.0', 'desktopVersion': '2.28.0-desktop.1', 'sourceHash': source_hash,
              'unitSuites': len(unit['suites']), 'unitChecks': sum(row['checksPassed'] for row in unit['suites']),
              'evidence': evidence, 'package': package, 'packageReceiptSha256': digest(package_path), 'requiredCiChecked': require_ci}
    target = ROOT / 'output/release/2.28.0-local/verification.json'
    target.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-ci', action='store_true')
    verify(parser.parse_args().require_ci)
