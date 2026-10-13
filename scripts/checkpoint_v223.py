"""Make a content-verified private checkpoint before the comparison upgrade."""
from pathlib import Path
import hashlib
import json
import shutil
import os

destination = Path(r"D:\Application\Strength&Conditioning\MotionBench-backups\20261013-before-2.23.0")
sources = {
    "program": Path(r"D:\Application\Strength&Conditioning\MotionBench"),
    "userdata": Path(os.environ["APPDATA"]) / "MotionBench Desktop",
}
if (destination / "manifest.json").exists():
    raise SystemExit("Completed checkpoint exists; inspect rather than overwrite")
destination.mkdir(parents=True, exist_ok=True)
def digest(path):
    with path.open("rb") as reader:
        return hashlib.file_digest(reader, "sha256").hexdigest()
manifest = {"sourceVersion": "2.22.0-desktop.1", "complete": False, "sources": {k: str(v) for k, v in sources.items()}, "files": []}
for kind, source in sources.items():
    if not source.is_dir():
        raise SystemExit("Expected source directory is missing: " + kind)
    for file in sorted(source.rglob("*")):
        if not file.is_file():
            continue
        relative = file.relative_to(source)
        target = destination / kind / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        # Streaming copies preserve readable content even for Windows EFS files.
        with file.open("rb") as reader, target.open("wb") as writer:
            shutil.copyfileobj(reader, writer)
        shutil.copystat(file, target)
        original_hash = digest(file)
        if digest(target) != original_hash or file.stat().st_size != target.stat().st_size:
            raise SystemExit("Checkpoint content mismatch")
        manifest["files"].append({"kind": kind, "relative": str(relative), "length": file.stat().st_size, "sha256": original_hash})
manifest["complete"] = True
(destination / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(json.dumps({"complete": True, "files": len(manifest["files"]), "bytes": sum(x["length"] for x in manifest["files"]), "destination": str(destination)}))
