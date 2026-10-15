"""Protect the installed 2.24.0 program and local data before this upgrade."""
from pathlib import Path
import hashlib
import json
import os
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DEST = Path(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261015-before-2.24.1')
SOURCES = {'program': Path(r'D:\Application\Strength&Conditioning\MotionBench'),
           'userdata': Path(os.environ['APPDATA']) / 'MotionBench Desktop'}


def digest(file):
    value = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def copy_verified(source, target):
    before = digest(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        with source.open('rb') as incoming, target.open('xb') as outgoing:
            for block in iter(lambda: incoming.read(1024 * 1024), b''):
                outgoing.write(block)
    if digest(source) != before or digest(target) != before:
        raise RuntimeError('Checkpoint file changed or differs: ' + str(target))
    return before


def main():
    # A normal close must have completed; never copy an actively written profile.
    running = subprocess.check_output(['powershell', '-NoProfile', '-Command',
        "@(Get-Process MotionBench -ErrorAction SilentlyContinue).Count"], text=True).strip()
    if running != '0':
        raise SystemExit('Close MotionBench normally before checkpointing.')
    entries = []
    for kind, directory in SOURCES.items():
        if not directory.is_dir():
            raise SystemExit('Missing checkpoint source: ' + kind)
        for source in sorted(directory.rglob('*')):
            if not source.is_file():
                continue
            relative = source.relative_to(directory)
            checksum = copy_verified(source, DEST / kind / relative)
            entries.append({'kind': kind, 'path': relative.as_posix(),
                            'bytes': source.stat().st_size, 'sha256': checksum})
    for profile in ('baseline-profile', 'candidate-profile'):
        for entry in entries:
            if entry['kind'] == 'userdata':
                copy_verified(DEST / 'userdata' / entry['path'], DEST / profile / entry['path'])
    bundle = DEST / 'source-2.24.0.bundle'
    if not bundle.exists():
        subprocess.run(['git', 'bundle', 'create', str(bundle), 'HEAD'], cwd=ROOT, check=True)
    result = {'complete': True, 'sourceCommit': subprocess.check_output(
        ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'files': entries}
    (DEST / 'manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'complete': True, 'files': len(entries),
                      'bytes': sum(entry['bytes'] for entry in entries), 'destination': str(DEST)}))


if __name__ == '__main__':
    main()
