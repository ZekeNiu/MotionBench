"""Build a clean end-user ZIP from an explicit allowlist."""
from pathlib import Path
import hashlib
import json
import re
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
destination = root / "output/release" / ("MotionBench-" + version + "-Windows.zip")
files = ["MotionBench.html", "Ringside_Boxing_Assessment.html", "Start_MotionBench.cmd", "scripts/serve.py", "README.md", f"docs/motionbench-{version}.md", f"docs/acceptance-{version}.json", "docs/speed-reference.md", "docs/architecture.md", "assets/motionbench-logo.svg", "examples/three-trials.json", "vendor/versions.json", "vendor/html2canvas.LICENSE.txt", "vendor/jspdf.LICENSE.txt"]
destination.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        data = (root / name).read_bytes()
        if re.search(rb"sk-[a-fA-F0-9]{32,}|gh[pousr]_[A-Za-z0-9]{30,}", data):
            raise SystemExit("Credential pattern found in " + name)
        archive.writestr("MotionBench/" + name, data)
print(destination.name + ": " + str(destination.stat().st_size) + " bytes")
print("SHA256 " + hashlib.sha256(destination.read_bytes()).hexdigest())
