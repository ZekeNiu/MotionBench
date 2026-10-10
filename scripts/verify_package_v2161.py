"""Verify the 2.16.1 allowlisted package and its extracted offline browser flow."""
from pathlib import Path
import hashlib
import json
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
archive_path = ROOT / "output/release/MotionBench-2.16.1-Windows.zip"
extracted = ROOT / "output/package-smoke/2.16.1"
extracted.mkdir(parents=True, exist_ok=True)
sha = hashlib.sha256((ROOT / "MotionBench.html").read_bytes()).hexdigest()
result = {"sourceHash": sha, "zipSHA256": hashlib.sha256(archive_path.read_bytes()).hexdigest(), "files": [], "browsers": [], "pass": False}
with zipfile.ZipFile(archive_path) as archive:
    names = archive.namelist()
    assert len(names) == len(set(names)) == 17
    for name in names:
        assert name.startswith("MotionBench/")
        relative = name.removeprefix("MotionBench/")
        source, target = (ROOT / relative).resolve(), (extracted / name).resolve()
        assert source.is_relative_to(ROOT) and target.is_relative_to(extracted) and source.is_file()
        data = archive.read(name)
        assert data == source.read_bytes(), relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        result["files"].append({"path": name, "sha256": hashlib.sha256(data).hexdigest(), "sourceMatches": True})
for channel in ["chrome", "msedge"]:
    args = ["node", "tests/athlete-context-package-tests.cjs", str(extracted / "MotionBench/MotionBench.html")]
    if channel == "msedge":
        args.append("--edge")
    run = subprocess.run(args, cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
    data = json.loads(run.stdout.strip().splitlines()[-1])
    assert data["pass"] and len(data["checks"]) == 4 and data["sourceHash"] == sha
    result["browsers"].append(data)
result["pass"] = True
(ROOT / "output/release/2.16.1-package-verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"PASS 17 package files, 8 packaged browser checks; {result['zipSHA256']}")
