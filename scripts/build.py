"""Build the offline standalone report from checked-in source and vendor files."""
from pathlib import Path
import base64
import json
import subprocess
import hashlib

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
manifest = json.loads((ROOT / "vendor" / "versions.json").read_text(encoding="utf-8"))
for dependency in manifest["dependencies"]:
    for file_key, hash_key in [("file", "sha256"), ("license_file", "license_sha256")]:
        path = ROOT / "vendor" / dependency[file_key]
        if hashlib.sha256(path.read_bytes()).hexdigest() != dependency[hash_key]:
            raise SystemExit("Pinned dependency checksum mismatch: " + str(path))
pieces = []
for name in ["ringside-calc.js", "ringside-sources.js", "ringside-definitions.js"]:
    path = SRC / name
    subprocess.run(["node", "--check", str(path)], check=True)
    pieces.append(path.read_text(encoding="utf-8"))
image = base64.b64encode((ROOT / "body-map-front.png").read_bytes()).decode("ascii")
pieces.append("window.RingsideBodyImage=" + json.dumps("data:image/png;base64," + image) + ";")
for name in ["html2canvas.min.js", "jspdf.umd.min.js"]:
    path = ROOT / "vendor" / name
    if not path.exists():
        raise SystemExit("Missing pinned offline dependency: " + str(path))
    pieces.append(path.read_text(encoding="utf-8"))
for name in ["ringside-tests.js", "ringside-model.js", "ringside-evaluation.js", "ringside-store.js", "ringside-interventions.js", "ringside-viz.js", "ringside-report.js", "ringside-ai-settings.js", "ringside-settings.js", "ringside-pdf.js", "ringside-management.js", "ringside-app.js"]:
    path = SRC / name
    subprocess.run(["node", "--check", str(path)], check=True)
    pieces.append(path.read_text(encoding="utf-8"))
shell = (SRC / "ringside-shell.html").read_text(encoding="utf-8")
assert shell.count("<!-- RINGSIDE_STYLES -->") == 1
styles = ["ringside.css", "ringside-workflow.css", "ringside-management-refinement.css", "ringside-report-refinement.css"]
shell = shell.replace("<!-- RINGSIDE_STYLES -->", "<style>\n" + "\n".join((SRC / name).read_text(encoding="utf-8") for name in styles) + "\n</style>")
assert shell.count("<!-- RINGSIDE_SCRIPTS -->") == 1
script_tags = "\n".join("<script>\n" + code.replace("</script", "<\\/script") + "\n</script>" for code in pieces)
result = shell.replace("<!-- RINGSIDE_SCRIPTS -->", script_tags)
destination = ROOT / "MotionBench.html"
destination.write_text(result, encoding="utf-8")
# Keep the established file path usable, preserving browser-local records.
(ROOT / "Ringside_Boxing_Assessment.html").write_text(result, encoding="utf-8")
print(f"Built {destination.name}: {destination.stat().st_size:,} bytes; {len(pieces)} offline scripts")
