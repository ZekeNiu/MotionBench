"""Verify the exact 2.29.1 focused report refinement against its synthetic regression evidence."""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/release/2.29.1-local/acceptance'


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
    directory = ROOT / 'output/release/2.29.1-local/desktop'
    archive = directory / 'win-unpacked/resources/app.asar'
    receipt = read(receipt_path)
    assert receipt['version'] == '2.29.1-desktop.1' and receipt['webVersion'] == '2.29.1'
    assert receipt.get('directoryOnly') is False and receipt.get('updaterConfigurationPresent') is True
    archive_hash = digest(archive)
    assert archive_hash == receipt['archiveSha256'], 'Package receipt belongs to another ASAR'
    inspected = inspect_package(directory)
    assert inspected['htmlIdentical'] and inspected['htmlSha256'] == source_hash, 'Packaged HTML differs from the tested build'
    assert inspected['build']['version'] == '2.29.1'
    assert inspected['files'] == sorted(receipt['files']), 'ASAR inventory differs from the package receipt'
    package = read(ROOT / 'package.json')
    assert inspected['package']['name'] == package['name'] and inspected['package']['main'] == 'desktop/main.cjs'
    for metadata in [inspected['package'], inspected['builder']['extraMetadata']]:
        assert metadata['version'] == '2.29.1-desktop.1' and metadata['webVersion'] == '2.29.1'
    for key, expected in {'provider': 'github', 'owner': 'ZekeNiu', 'repo': 'MotionBench', 'channel': 'desktop'}.items():
        assert inspected['appUpdater'].get(key) == expected, 'Packaged updater identity differs: ' + key
    setup = directory / 'MotionBench-2.29.1-desktop.1-Setup-x64.exe'
    portable = directory / 'MotionBench-2.29.1-desktop.1-Portable-x64.exe'
    sources = [setup, Path(str(setup) + '.blockmap'), portable, directory / 'desktop.yml']
    assets = []
    for file in sources:
        assert file.is_file() and file.stat().st_size > 0, 'Missing or empty release asset: ' + file.name
        assets.append({'file': file.name, 'bytes': file.stat().st_size, 'sha256': digest(file),
                       'sha512': base64.b64encode(bytes.fromhex(digest(file, 'sha512'))).decode('ascii')})
    by_name = {item['file']: item for item in assets}
    updater = inspected['updater']
    installer = by_name[setup.name]
    assert updater['version'] == '2.29.1-desktop.1' and updater['path'] == setup.name
    assert updater['sha512'] == installer['sha512'] and len(updater['files']) == 1, 'Update installer SHA512 differs'
    entry = updater['files'][0]
    assert entry['url'] == setup.name and entry['size'] == installer['bytes'] and entry['sha512'] == installer['sha512'], 'Update installer URL, size or SHA512 differs'
    return {'archiveSha256': archive_hash, 'htmlSha256': inspected['htmlSha256'], 'assets': len(inspected['files']),
            'installerSha256': installer['sha256'], 'portableSha256': by_name[portable.name]['sha256'],
            'updaterSha256': by_name['desktop.yml']['sha256'], 'artifacts': assets}



def verify(require_ci=False):
    assert read(ROOT / 'package.json')['version'] == '2.29.1'
    source_hash = digest(ROOT / 'MotionBench.html')
    evidence = []

    def record(relative, runner, minimum, channel=None, modules=False, suites=False):
        file = OUT / relative
        value = read(file)
        assert not value.get('failure') and not value.get('error') and not value.get('errors'), str(file)
        assert value.get('runnerSha256') == digest(ROOT / runner), runner
        assert value.get('sourceUnchanged') is True, str(file)
        if modules:
            assert value.get('sources'), str(file)
            for name, expected in value['sources'].items():
                assert digest(ROOT / name) == expected, name
        else:
            assert value.get('sourceHash') == source_hash, str(file)
        for name, expected in value.get('sourceHashes', {}).items():
            assert digest(ROOT / name) == expected, name
        if channel:
            assert value.get('channel') == channel
        rows = value['suites'] if suites else value['checks']
        assert len(rows) >= minimum
        if suites:
            assert all(row['exitCode'] == 0 and row['sourceUnchanged'] is True for row in rows)
            for row in rows:
                assert digest(ROOT / 'tests' / row['name']) == row['sha256'], row['name']
            for name, expected in value.get('modules', {}).items():
                assert digest(ROOT / 'src' / name) == expected, name
        else:
            assert value.get('pass') is True
        for item in value.get('artifacts', []):
            artifact = Path(item['path'])
            if not artifact.is_absolute():
                artifact = ROOT / artifact
            assert digest(artifact) == item['sha256'], str(artifact)
            if 'bytes' in item:
                assert artifact.stat().st_size == item['bytes']
        evidence.append({'file': file.relative_to(ROOT).as_posix(), 'sha256': digest(file), 'checks': len(rows)})
        return value

    required = {'team-comparison-model-tests.cjs', 'team-comparison-view-tests.cjs',
                'team-store-model-tests.cjs', 'team-selection-model-tests.cjs', 'report-selection-model-tests.cjs'}
    unit = record('unit-final/unit-results.json', 'tests/run-unit-tests.cjs', len(required), suites=True)
    assert {row['name'] for row in unit['suites']} == required
    for channel in ['chrome', 'msedge']:
        record('selection-' + channel + '/results.json', 'tests/report-selection-regression-browser-tests.cjs', 4, channel)
        record('step-navigation-' + channel + '/results.json', 'tests/workflow-step-navigation-browser-tests.cjs', 4, channel)
        record('team-comparison-view-' + channel + '/receipt.json', 'tests/team-comparison-view-browser-tests.cjs', 10, channel, modules=True)

    work = OUT.parent
    package_path = work / 'package-check.json'
    package = package_evidence(source_hash, package_path)
    native_path = work / 'native-smoke/results.json'
    native = read(native_path)
    assert native['pass'] and not native.get('failure') and not native.get('errors') and not native.get('cleanupErrors')
    assert len(native['checks']) >= 3 and native.get('artifactUnchanged', native.get('sourceUnchanged')) is True
    assert native['identity']['archiveSha256'] == package['archiveSha256']
    assert native['identity']['runtimeHtmlSha256'] == source_hash
    assert native['identity']['testScriptSha256'] == digest(ROOT / 'tests/report-refinement-native-tests.cjs')
    pdfs = []
    for item in native['artifacts']:
        file = native_path.parent / item['path']
        assert digest(file) == item['sha256'] and file.stat().st_size == item['bytes']
        if file.suffix.lower() == '.pdf':
            pdfs.append(item)
            assert item['diagnostics']['status'] == 'complete'
            for key in ['missingRows', 'duplicateRows', 'changedRows', 'missingCharts', 'duplicateCharts']:
                assert item['diagnostics'][key] == [], str(file) + ': ' + key
    assert len(pdfs) >= 2, 'Both team comparison PDF exports are required'
    evidence.append({'file': native_path.relative_to(ROOT).as_posix(), 'sha256': digest(native_path), 'checks': len(native['checks'])})
    if require_ci:
        ci = read(work / 'ci-status.json')
        assert ci.get('pass') is True and ci.get('complete') is True
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        assert ci['commit'] == commit
        expected = {('.github/workflows/horizontal-windows.yml', 'main'),
                    ('.github/workflows/horizontal-windows.yml', 'v2.29.1-desktop.1'),
                    ('.github/workflows/public-demo.yml', 'main')}
        assert len(ci['runs']) == 3
        assert {(row['path'], row.get('headBranch', row.get('head_branch'))) for row in ci['runs']} == expected
        assert all(row.get('headSha', row.get('head_sha')) == commit and row['status'] == 'completed' and row['conclusion'] == 'success' for row in ci['runs'])
    production_files = subprocess.check_output(['git', 'ls-files', 'src', 'desktop', 'vendor', 'scripts/build.py'], cwd=ROOT, text=True).splitlines()
    result = {'pass': True, 'version': '2.29.1', 'desktopVersion': '2.29.1-desktop.1', 'sourceHash': source_hash,
              'unitSuites': len(unit['suites']), 'unitChecks': sum(row['checksPassed'] or sum(line.startswith('PASS ') for line in row.get('stdout', '').splitlines()) for row in unit['suites']),
              'evidence': evidence, 'package': package, 'packageReceiptSha256': digest(package_path),
              'baseline': 'c5ee6dfb02de2fee7a83962ddd9ab9f8538e638a',
              'productionSourceHashes': {name: digest(ROOT / name) for name in production_files},
              'requiredUnitSuites': sorted(required), 'requiredCiChecked': require_ci}
    (work / 'verification.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-ci', action='store_true')
    verify(parser.parse_args().require_ci)
