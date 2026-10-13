"""Record the verified local build without uploading artifacts or private data."""
from pathlib import Path
import datetime
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/release/2.24.0-local'


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def entry(path):
    return {'path': path.relative_to(ROOT).as_posix(), 'bytes': path.stat().st_size, 'sha256': digest(path)}


def main():
    subprocess.run([sys.executable, str(ROOT / 'scripts/verify_v224.py'), '--require-private'], cwd=ROOT, check=True)
    subprocess.run([sys.executable, str(ROOT / 'scripts/verify_v224_supplement.py')], cwd=ROOT, check=True)
    acceptance = json.loads((ROOT / 'docs/acceptance-2.24.0.json').read_text(encoding='utf-8'))
    supplement = json.loads((ROOT / 'docs/acceptance-2.24.0-supplement.json').read_text(encoding='utf-8'))
    source_hash = digest(ROOT / 'MotionBench.html')
    assert acceptance['pass'] and acceptance['privateVerified']
    assert supplement['pass'] or supplement['passedWithRecordedEnvironmentIssue']
    assert acceptance['sourceHash'] == supplement['sourceHash'] == source_hash
    assets = [ROOT / name for name in (
        'MotionBench.html', 'dist-desktop/MotionBench-2.24.0-desktop.1-Setup-x64.exe',
        'dist-desktop/MotionBench-2.24.0-desktop.1-Portable-x64.exe',
        'dist-desktop/MotionBench-2.24.0-desktop.1-Setup-x64.exe.blockmap',
        'dist-desktop/desktop.yml', 'dist-desktop/win-unpacked/resources/app.asar',
        'docs/acceptance-2.24.0.json', 'docs/acceptance-2.24.0-supplement.json')]
    sources = sorted(list((ROOT / 'src').glob('*')) + list((ROOT / 'desktop').glob('*.cjs')) +
                     [ROOT / name for name in ('package.json', 'package-lock.json', 'electron-builder.yml', 'scripts/build.py')])
    result = {'version': '2.24.0', 'desktopVersion': '2.24.0-desktop.1', 'delivery': 'local-original-directory',
              'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'baseCommit': 'a61a0a087b09aca948e62668115e0a894818040e',
              'headAtPackaging': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'workingTreeAtPackaging': subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).splitlines(),
              'sourceHash': source_hash, 'assets': [entry(path) for path in assets],
              'sourceFiles': [entry(path) for path in sources if path.is_file()],
              'acceptanceStatus': supplement['status'], 'privateDataIncluded': False}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'build-provenance.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (OUT / 'SHA256SUMS.txt').write_text(''.join(item['sha256'] + '  ' + item['path'] + '\n' for item in result['assets']), encoding='utf-8')
    print(json.dumps({'version': result['version'], 'assets': len(assets), 'sourceHash': source_hash}))


if __name__ == '__main__':
    main()
