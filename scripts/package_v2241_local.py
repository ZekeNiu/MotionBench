"""Archive the verified local package identity, excluding private data."""
from pathlib import Path
import datetime
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/release/2.24.1-local'


def entry(file):
    value = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return {'file': file.relative_to(ROOT).as_posix(), 'bytes': file.stat().st_size, 'sha256': value.hexdigest()}


def main():
    subprocess.run([sys.executable, str(ROOT / 'scripts/verify_v2241.py'), '--require-private'], cwd=ROOT, check=True)
    acceptance = json.loads((ROOT / 'docs/acceptance-2.24.1.json').read_text(encoding='utf-8'))
    html = entry(ROOT / 'MotionBench.html')
    assert acceptance['pass'] and acceptance['privateVerified'] and acceptance['sourceHash'] == html['sha256']
    assets = [entry(ROOT / name) for name in ('MotionBench.html',
        'dist-desktop/MotionBench-2.24.1-desktop.1-Setup-x64.exe',
        'dist-desktop/MotionBench-2.24.1-desktop.1-Portable-x64.exe',
        'dist-desktop/MotionBench-2.24.1-desktop.1-Setup-x64.exe.blockmap',
        'dist-desktop/desktop.yml', 'dist-desktop/win-unpacked/resources/app.asar',
        'docs/acceptance-2.24.1.json', 'docs/acceptance-2.24.1.md')]
    sources = sorted([file for folder in ('src', 'desktop') for file in (ROOT / folder).iterdir() if file.is_file()])
    result = {'version': '2.24.1', 'desktopVersion': '2.24.1-desktop.1',
              'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'baseCommit': '07ff5076afed67d1269b17f9fe8258a24dba2371',
              'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'workingTree': subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).splitlines(),
              'sourceHash': html['sha256'], 'assets': assets, 'sourceFiles': [entry(file) for file in sources],
              'runtimeSource': {'version': (ROOT / 'node_modules/electron/dist/version').read_text().strip(),
                                'executable': entry(ROOT / 'node_modules/electron/dist/electron.exe')},
              'packageRecipe': ['python scripts/build.py',
                                'electron-builder --config electron-builder.yml --win --x64 --publish never --config.electronDist=node_modules/electron/dist',
                                'Remove only the copied runtime version and resources/default_app.asar from dist-desktop/win-unpacked',
                                'electron-builder --config electron-builder.yml --win --x64 --publish never --prepackaged dist-desktop/win-unpacked'],
              'privateDataIncluded': False, 'delivery': 'local-original-directory'}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'build-provenance.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (OUT / 'SHA256SUMS.txt').write_text(''.join(item['sha256'] + '  ' + item['file'] + '\n' for item in assets), encoding='utf-8')
    print(json.dumps({'version': '2.24.1', 'assets': len(assets), 'sourceHash': html['sha256']}))


if __name__ == '__main__':
    main()
