"""Protect the installed program and all current data before the summary update."""
from pathlib import Path
import json
import os
import subprocess
from prepare_v2241_checkpoint import copy_verified

ROOT = Path(__file__).resolve().parents[1]
DEST = Path(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261015-before-2.24.2')


def main():
    running = subprocess.check_output(['powershell', '-NoProfile', '-Command',
        "@(Get-Process MotionBench -ErrorAction SilentlyContinue).Count"], text=True).strip()
    if running != '0':
        raise SystemExit('Close MotionBench normally before checkpointing.')
    if (DEST / 'manifest.json').exists():
        raise SystemExit('Checkpoint already exists; preserve it.')
    entries = []
    sources = {'program': Path(r'D:\Application\Strength&Conditioning\MotionBench'),
               'userdata': Path(os.environ['APPDATA']) / 'MotionBench Desktop'}
    for kind, directory in sources.items():
        if not directory.is_dir():
            raise SystemExit('Missing checkpoint source: ' + kind)
        for source in sorted(directory.rglob('*')):
            if not source.is_file():
                continue
            relative = source.relative_to(directory)
            checksum = copy_verified(source, DEST / kind / relative)
            entries.append({'kind': kind, 'path': relative.as_posix(),
                            'bytes': source.stat().st_size, 'sha256': checksum})
    for profile in ('baseline-profile', 'copied-profile'):
        for entry in entries:
            if entry['kind'] == 'userdata':
                copy_verified(DEST / 'userdata' / entry['path'], DEST / profile / entry['path'])
    subprocess.run(['git', 'bundle', 'create', str(DEST / 'source-2.24.1.bundle'), 'HEAD'], cwd=ROOT, check=True)
    result = {'complete': True, 'sourceCommit': subprocess.check_output(
        ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'files': entries}
    (DEST / 'manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'complete': True, 'files': len(entries),
                      'bytes': sum(entry['bytes'] for entry in entries), 'destination': str(DEST)}))


if __name__ == '__main__':
    main()
