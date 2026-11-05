"""Verify the exact 2.28.1 build against its synthetic regression evidence."""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/release/2.28.1-local/acceptance'


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
    directory = ROOT / 'output/release/2.28.1-local/desktop'
    archive = directory / 'win-unpacked/resources/app.asar'
    receipt = read(receipt_path)
    assert receipt['version'] == '2.28.1-desktop.1' and receipt['webVersion'] == '2.28.1'
    assert receipt.get('directoryOnly') is False and receipt.get('updaterConfigurationPresent') is True
    archive_hash = digest(archive)
    assert archive_hash == receipt['archiveSha256'], 'Package receipt belongs to another ASAR'
    inspected = inspect_package(directory)
    assert inspected['htmlIdentical'] and inspected['htmlSha256'] == source_hash, 'Packaged HTML differs from the tested build'
    assert inspected['build']['version'] == '2.28.1'
    assert inspected['files'] == sorted(receipt['files']), 'ASAR inventory differs from the package receipt'
    package = read(ROOT / 'package.json')
    assert inspected['package']['name'] == package['name'] and inspected['package']['main'] == 'desktop/main.cjs'
    for metadata in [inspected['package'], inspected['builder']['extraMetadata']]:
        assert metadata['version'] == '2.28.1-desktop.1' and metadata['webVersion'] == '2.28.1'
    for key, expected in {'provider': 'github', 'owner': 'ZekeNiu', 'repo': 'MotionBench', 'channel': 'desktop'}.items():
        assert inspected['appUpdater'].get(key) == expected, 'Packaged updater identity differs: ' + key
    setup = directory / 'MotionBench-2.28.1-desktop.1-Setup-x64.exe'
    portable = directory / 'MotionBench-2.28.1-desktop.1-Portable-x64.exe'
    sources = [setup, Path(str(setup) + '.blockmap'), portable, directory / 'desktop.yml']
    assets = []
    for file in sources:
        assert file.is_file() and file.stat().st_size > 0, 'Missing or empty release asset: ' + file.name
        assets.append({'file': file.name, 'bytes': file.stat().st_size, 'sha256': digest(file),
                       'sha512': base64.b64encode(bytes.fromhex(digest(file, 'sha512'))).decode('ascii')})
    by_name = {item['file']: item for item in assets}
    updater = inspected['updater']
    installer = by_name[setup.name]
    assert updater['version'] == '2.28.1-desktop.1' and updater['path'] == setup.name
    assert updater['sha512'] == installer['sha512'] and len(updater['files']) == 1, 'Update installer SHA512 differs'
    entry = updater['files'][0]
    assert entry['url'] == setup.name and entry['size'] == installer['bytes'] and entry['sha512'] == installer['sha512'], 'Update installer URL, size or SHA512 differs'
    return {'archiveSha256': archive_hash, 'htmlSha256': inspected['htmlSha256'], 'assets': len(inspected['files']),
            'installerSha256': installer['sha256'], 'portableSha256': by_name[portable.name]['sha256'],
            'updaterSha256': by_name['desktop.yml']['sha256'], 'artifacts': assets}


def verify(require_ci=False):
    assert read(ROOT / 'package.json')['version'] == '2.28.1'
    source_hash = digest(ROOT / 'MotionBench.html')
    subprocess.run(['python', str(ROOT / 'scripts/build.py')], cwd=ROOT, check=True)
    assert digest(ROOT / 'MotionBench.html') == source_hash, 'Build changed the tested HTML'
    evidence = []

    def record(file, runner, minimum, suites=False, channel=None):
        value = read(file)
        assert value.get('sourceHash', value.get('sourceSHA256', value.get('identity', {}).get('sourceHtmlSha256'))) == source_hash, str(file)
        assert value.get('runnerSha256', value.get('identity', {}).get('testScriptSha256')) == digest(ROOT / runner), runner
        assert not value.get('failure') and not value.get('error') and not value.get('errors'), str(file)
        if channel:
            assert value.get('channel') == channel, str(file)
        rows = value['suites'] if suites else value['checks']
        assert len(rows) >= minimum, str(file)
        if suites:
            assert value['sourceUnchanged'] is True
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
        for item in value.get('artifacts', []):
            artifact = Path(item.get('path') or item.get('file'))
            if not artifact.is_absolute():
                artifact = ROOT / artifact
            assert digest(artifact) == item['sha256'], str(artifact)
        evidence.append({'file': file.relative_to(ROOT).as_posix(), 'sha256': digest(file), 'checks': len(rows)})
        return value

    unit = record(OUT / 'unit-final/unit-results.json', 'tests/run-unit-tests.cjs', 10, suites=True)
    required = {'report-navigation-state-tests.cjs', 'longitudinal-navigation-state-tests.cjs', 'report-selection-model-tests.cjs', 'team-selection-model-tests.cjs',
                'report-owner-model-tests.cjs', 'longitudinal-store-model-tests.cjs', 'longitudinal-display-state-tests.cjs',
                'ordinary-save-model-tests.cjs', 'entry-session-save-model-tests.cjs', 'personal-report-appearance-tests.cjs'}
    assert required <= {row['name'] for row in unit['suites']}, 'Missing changed-flow unit suites'
    record(OUT / 'desktop-unit/results.json', 'tests/run-desktop-unit-tests.cjs', 5, suites=True)
    for channel in ['chrome', 'msedge']:
        nav = record(OUT / ('navigation-' + channel) / 'results.json', 'tests/report-navigation-browser-tests.cjs', 12, channel=channel)
        assert nav['fixtureSha256'] == digest(ROOT / 'tests/helpers/longitudinal-fixture.cjs')
        if channel == 'chrome':
            assert nav['pdfRequested'] and nav['pdfDiagnostics']['status'] == 'complete'
            assert any(item['kind'] == 'pdf' for item in nav['artifacts'])

    # The approved change alters selection and adoption, not calculations or export layout.
    # Prove every other production module is byte-identical to the delivered base.
    baseline = '3aa6020aca0ffdf5fbde7226d9f811ef6205b0f5'
    changed = {'ringside-app.js', 'ringside-longitudinal-controller.js', 'ringside-report-selection.js',
               'ringside-report-selection.css', 'ringside-team-selection.js', 'ringside-team-selection.css',
               'ringside-shell.html', 'ringside-workflow.css'}
    unchanged = {}
    for file in sorted((ROOT / 'src').iterdir()):
        if not file.is_file() or file.name in changed:
            continue
        previous = subprocess.check_output(['git', 'show', baseline + ':src/' + file.name], cwd=ROOT)
        expected = hashlib.sha256(previous).hexdigest()
        assert digest(file) == expected, 'Unexpected production change: ' + file.name
        unchanged[file.name] = expected

    package_path = ROOT / 'output/release/2.28.1-local/package-check.json'
    package = package_evidence(source_hash, package_path)
    native_path = ROOT / 'output/release/2.28.1-local/native-smoke/results.json'
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
        ci = read(ROOT / 'output/release/2.28.1-local/ci-status.json')
        assert ci.get('pass') is True and ci.get('complete') is True
        assert ci['commit'] == subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    result = {'pass': True, 'version': '2.28.1', 'desktopVersion': '2.28.1-desktop.1', 'sourceHash': source_hash,
              'unitSuites': len(unit['suites']), 'unitChecks': sum(row['checksPassed'] or sum(line.startswith('PASS ') for line in row.get('stdout', '').splitlines()) for row in unit['suites']),
              'evidence': evidence, 'package': package, 'packageReceiptSha256': digest(package_path),
              'baseline': baseline, 'unchangedProductionModules': unchanged, 'requiredCiChecked': require_ci}
    target = ROOT / 'output/release/2.28.1-local/verification.json'
    target.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-ci', action='store_true')
    verify(parser.parse_args().require_ci)

