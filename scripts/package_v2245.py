"""Stage only the ten verified public 2.24.5 release assets."""
from pathlib import Path
import base64, datetime, hashlib, json, shutil, subprocess, sys
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/release/2.24.5'
def sha(file): return hashlib.sha256(file.read_bytes()).hexdigest()
def git(*args): return subprocess.check_output(['git', *args], cwd=ROOT, text=True, encoding='utf-8').strip()
def main():
    assert not git('status', '--porcelain'), 'Commit the final accepted source and documentation first'
    subprocess.run([sys.executable, 'scripts/verify_v2245.py', '--require-private'], cwd=ROOT, check=True)
    commit = git('rev-parse', 'HEAD'); proof = json.loads((ROOT / 'docs/acceptance-2.24.5.json').read_text(encoding='utf-8'))
    assert proof['pass'] and proof['privateVerified'] and proof['sourceHash'] == sha(ROOT / 'MotionBench.html')
    files = ['MotionBench.html', 'dist-desktop/MotionBench-2.24.5-desktop.1-Setup-x64.exe', 'dist-desktop/MotionBench-2.24.5-desktop.1-Portable-x64.exe',
             'dist-desktop/MotionBench-2.24.5-desktop.1-Setup-x64.exe.blockmap', 'dist-desktop/desktop.yml', 'dist-desktop/win-unpacked/resources/app.asar',
             'docs/acceptance-2.24.5.md', 'docs/acceptance-2.24.5.json']
    OUT.mkdir(parents=True, exist_ok=True); assert not (OUT / 'build-provenance.json').exists()
    assets = []
    for relative in files:
        original = ROOT / relative; destination = OUT / original.name; shutil.copyfile(original, destination)
        assert sha(original) == sha(destination)
        assets.append({'file': destination.name, 'source': relative, 'bytes': destination.stat().st_size, 'sha256': sha(destination)})
    setup = OUT / 'MotionBench-2.24.5-desktop.1-Setup-x64.exe'
    assert base64.b64encode(hashlib.sha512(setup.read_bytes()).digest()).decode() in (OUT / 'desktop.yml').read_text()
    inputs = git('ls-files', '--', 'src', 'desktop', 'vendor', 'MotionBench.html', 'package.json', 'package-lock.json', 'electron-builder.yml', 'scripts/build.py',
                 'scripts/verify_v2245.py', 'scripts/verify_v2245_preinstall.py', 'scripts/install_v2245_system.ps1', 'scripts/prepare_v2245_system.ps1',
                 'scripts/check_v2245_shortcut.ps1', 'scripts/run_system_v2245.py', 'tests/desktop-system-v2245.cjs', 'tests/desktop-system-v2245-reopened.cjs',
                 'tests/helpers/v2244-display-preservation.cjs', 'tests/longitudinal-followup-browser-tests.cjs').splitlines()
    source_files = []
    for name in inputs:
        data = (ROOT / name).read_bytes()
        assert subprocess.check_output(['git', 'show', commit + ':' + name], cwd=ROOT) == data, 'Working bytes differ from recorded commit'
        source_files.append({'file': name, 'bytes': len(data), 'sha256': sha(ROOT / name)})
    provenance = {'version': '2.24.5', 'desktopVersion': '2.24.5-desktop.1', 'commit': commit, 'workingTree': [],
                  'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sourceHash': proof['sourceHash'], 'assets': assets, 'sourceFiles': source_files,
                  'buildNote': 'The binaries were built before the final acceptance/documentation commit. Runtime input hashes and the packaged HTML match the accepted source recorded here.',
                  'electron': json.loads((ROOT / 'package.json').read_text())['devDependencies']['electron'], 'privateDataIncluded': False}
    (OUT / 'build-provenance.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    names = [Path(p).name for p in files] + ['build-provenance.json']
    (OUT / 'SHA256SUMS.txt').write_text(''.join(sha(OUT / name) + '  ' + name + '\n' for name in names), encoding='ascii')
    inventory = [{'file': name, 'bytes': (OUT / name).stat().st_size, 'sha256': sha(OUT / name)} for name in [*names, 'SHA256SUMS.txt']]
    assert len(inventory) == 10
    (ROOT / 'output/implementation-2.24.5/release-assets.json').write_text(json.dumps({'commit': commit, 'assets': inventory}, indent=2) + '\n')
    print(json.dumps({'commit': commit, 'assets': 10, 'sourceHash': proof['sourceHash']}))
if __name__ == '__main__': main()
