"""Create a byte-verified private checkpoint without copying private data to the repo."""
from pathlib import Path
import hashlib, json, os, subprocess

ROOT = Path(__file__).resolve().parents[1]
DEST = Path(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261014-before-2.24.0')
SOURCES = {'program': Path(r'D:\Application\Strength&Conditioning\MotionBench'), 'userdata': Path(os.environ['APPDATA']) / 'MotionBench Desktop'}
def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()
DEST.mkdir(parents=True, exist_ok=True)
entries = []
for kind, source in SOURCES.items():
    if not source.is_dir(): raise SystemExit('Missing checkpoint source: ' + kind)
    for item in sorted(source.rglob('*')):
        if not item.is_file(): continue
        relative = item.relative_to(source)
        target = DEST / kind / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        before = digest(item)
        if not target.exists():
            with item.open('rb') as src, target.open('xb') as out:
                for block in iter(lambda: src.read(1024 * 1024), b''): out.write(block)
        after, copied = digest(item), digest(target)
        if before != after or before != copied: raise SystemExit('Checkpoint mismatch: ' + kind + '/' + str(relative))
        entries.append({'kind': kind, 'path': relative.as_posix(), 'bytes': item.stat().st_size, 'sha256': copied})
manifest = {'complete': True, 'sourceCommit': subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(), 'files': entries}
(DEST / 'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'complete':True,'files':len(entries),'bytes':sum(x['bytes'] for x in entries),'destination':str(DEST)}))
