"""Record the verified local 2.24.3 package identity without private snapshots."""
from pathlib import Path
import datetime
import json
import subprocess
import sys

from verify_v224 import digest

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/release/2.24.3-local'
CHECKPOINT = Path(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261016-system-before-2.24.3')


def entry(file):
    return {'file': file.relative_to(ROOT).as_posix(), 'bytes': file.stat().st_size, 'sha256': digest(file)}


def main():
    subprocess.run([sys.executable, str(ROOT / 'scripts/verify_v2243.py'), '--require-private', '--record'], cwd=ROOT, check=True)
    acceptance = json.loads((ROOT / 'docs/acceptance-2.24.3.json').read_text(encoding='utf-8'))
    html = entry(ROOT / 'MotionBench.html')
    assert acceptance['pass'] and acceptance['privateVerified'] and acceptance['sourceHash'] == html['sha256']
    assets = [entry(ROOT / name) for name in ('MotionBench.html',
        'dist-desktop/MotionBench-2.24.3-desktop.1-Setup-x64.exe',
        'dist-desktop/MotionBench-2.24.3-desktop.1-Portable-x64.exe',
        'dist-desktop/MotionBench-2.24.3-desktop.1-Setup-x64.exe.blockmap',
        'dist-desktop/desktop.yml', 'dist-desktop/win-unpacked/resources/app.asar',
        'docs/acceptance-2.24.3.json', 'docs/acceptance-2.24.3.md')]
    sources = sorted(file for folder in ('src', 'desktop') for file in (ROOT / folder).iterdir() if file.is_file())
    manifest = json.loads((CHECKPOINT / 'manifest.json').read_text(encoding='utf-8-sig'))
    result = {'version': '2.24.3', 'desktopVersion': '2.24.3-desktop.1', 'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'baseCommit': manifest['sourceCommit'], 'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'workingTree': subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).splitlines(),
              'sourceHash': html['sha256'], 'assets': assets, 'sourceFiles': [entry(file) for file in sources],
              'runtimeSource': {'version': (ROOT / 'node_modules/electron/dist/version').read_text().strip(), 'executable': entry(ROOT / 'node_modules/electron/dist/electron.exe')},
              'packageRecipe': ['python scripts/build.py', 'electron-builder --config electron-builder.yml --dir --publish never --config.electronDist=node_modules/electron/dist', 'Move only copied runtime version and resources/default_app.asar to the recorded workspace archive', 'Generate resources/app-update.yml from current publish settings; verify identical configuration to the previous installed program', 'electron-builder --config electron-builder.yml --win --x64 --publish never --prepackaged dist-desktop/win-unpacked'],
              'privateDataIncluded': False, 'delivery': 'local-original-directory'}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'build-provenance.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (OUT / 'SHA256SUMS.txt').write_text(''.join(item['sha256'] + '  ' + item['file'] + '\n' for item in assets), encoding='utf-8')
    print(json.dumps({'version': '2.24.3', 'assets': len(assets), 'sourceHash': html['sha256']}))


if __name__ == '__main__':
    main()
