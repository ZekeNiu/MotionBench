"""Package only the files reachable from the verified 2.19.0 manifest."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "output/release/MotionBench-2.19.0-evidence.zip"
included = {}


def include(relative, expected=None):
    path = (ROOT / relative).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file():
        raise ValueError(f"Invalid evidence path: {relative}")
    relative = path.relative_to(ROOT).as_posix()
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if expected and actual != expected:
        raise ValueError(f"Evidence changed: {relative}")
    if relative in included:
        return
    included[relative] = actual
    if path.suffix == ".json":
        visit(json.loads(path.read_text(encoding="utf-8-sig")))


def visit(value):
    if isinstance(value, dict):
        relative = value.get("path", value.get("file"))
        expected = value.get("sha256")
        if isinstance(relative, str) and isinstance(expected, str):
            include(relative, expected)
        for item in value.values():
            visit(item)
    elif isinstance(value, list):
        for item in value:
            visit(item)


include("docs/acceptance-2.19.0.json")
include("docs/acceptance-2.19.0.md")
include("docs/motionbench-2.19.0.md")
for name in ["input.xlsx", "excel-saved.xlsx", "fixture.json", "excel-run.json"]:
    include("output/tests/v219-excel-native/" + name)
for channel in ["chrome", "msedge"]:
    for name in ["migration-report.json", "raw-upgrade-backup.jsonl"]:
        include(f"output/playwright/v2.19.0/storage/{channel}-{name}")

DEST.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(DEST, "w", zipfile.ZIP_DEFLATED) as archive:
    for relative in sorted(included):
        archive.write(ROOT / relative, relative)
    archive.writestr("evidence-files.json", json.dumps(included, indent=2))
print(json.dumps({"path": DEST.relative_to(ROOT).as_posix(), "files": len(included),
                  "bytes": DEST.stat().st_size, "sha256": hashlib.sha256(DEST.read_bytes()).hexdigest()}))
