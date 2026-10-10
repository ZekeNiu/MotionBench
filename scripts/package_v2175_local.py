"""Package only verified application files and synthetic review screenshots."""
from pathlib import Path
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = "2.17.5-local"
manifest = json.loads((ROOT / "docs/acceptance-2.17.5-local.json").read_text(encoding="utf-8"))
if manifest.get("version") != VERSION or manifest.get("localReviewable") is not True or manifest.get("fullAcceptancePass") is not True:
    raise SystemExit("The frozen 2.17.5 application has not passed acceptance")
source = (ROOT / "MotionBench.html").read_bytes()
if hashlib.sha256(source).hexdigest() != manifest["sourceHash"]:
    raise SystemExit("Application changed after acceptance")
if not re.search(rb'<script[^>]+id="embedded-data"[^>]*>\s*null\s*</script>', source):
    raise SystemExit("Only the clean application, without embedded records, may be packaged")
files = ["MotionBench.html", "Start_MotionBench.cmd", "scripts/serve.py", "scripts/ai_credentials.py",
         "README.md", "docs/sprint-display-2.17.5.md", "docs/sprint-display-screenshots-2.17.5.md",
         "docs/acceptance-2.17.5-local.json", "assets/motionbench-logo.svg", "vendor/versions.json",
         "vendor/html2canvas.LICENSE.txt", "vendor/jspdf.LICENSE.txt", "vendor/exceljs.LICENSE.txt"]
files += sorted(str(p.relative_to(ROOT)).replace("\\", "/") for p in (ROOT / "downloads/sprint-display-2.17.5").glob("*.png"))
if not any(name.endswith(".png") for name in files):
    raise SystemExit("Reviewed synthetic screenshots are missing")
destination = ROOT / "downloads/MotionBench-v2.17.5-local-preview.zip"
destination.parent.mkdir(parents=True, exist_ok=True)
rows = []
with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        data = (ROOT / name).read_bytes()
        if re.search(rb"sk-[a-fA-F0-9]{32,}|gh[pousr]_[A-Za-z0-9]{30,}", data):
            raise SystemExit("Credential pattern found: " + name)
        archive.writestr("MotionBench/" + name, data)
        rows.append({"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
with zipfile.ZipFile(destination) as archive:
    if archive.testzip() is not None or len(archive.namelist()) != len(rows):
        raise SystemExit("ZIP verification failed")
    for row in rows:
        if hashlib.sha256(archive.read("MotionBench/" + row["path"])).hexdigest() != row["sha256"]:
            raise SystemExit("ZIP member changed: " + row["path"])
receipt = {"version": VERSION, "pass": True, "sourceHash": manifest["sourceHash"],
           "zip": {"path": str(destination.relative_to(ROOT)).replace("\\", "/"),
                   "bytes": destination.stat().st_size, "sha256": hashlib.sha256(destination.read_bytes()).hexdigest()},
           "crcChecked": True, "files": rows, "realAthleteDataIncluded": False}
output = ROOT / "output/release/v2175-package-receipt.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"pass": True, "files": len(rows), **receipt["zip"]}, ensure_ascii=False))
