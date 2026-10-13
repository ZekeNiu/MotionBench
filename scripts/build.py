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
package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
version = package["version"]
if not isinstance(version, str) or not version.strip():
    raise SystemExit("Missing application version in package.json")
pieces = ["window.RingsideBuild=Object.freeze(" + json.dumps({"version": version}) + ");"]
for name in ["ringside-calc.js", "ringside-fvp.js", "ringside-sprint-fvp.js", "ringside-sprint-elasticity.js", "ringside-sprint-fvp-confidence.js", "ringside-sources.js", "ringside-cpet-reference.js", "ringside-iso-reference.js", "ringside-definitions.js"]:
    path = SRC / name
    subprocess.run(["node", "--check", str(path)], check=True)
    pieces.append(path.read_text(encoding="utf-8"))
image = base64.b64encode((ROOT / "body-map-front.png").read_bytes()).decode("ascii")
pieces.append("window.RingsideBodyImage=" + json.dumps("data:image/png;base64," + image) + ";")
for name in ["html2canvas.min.js", "jspdf.umd.min.js", "exceljs.min.js"]:
    path = ROOT / "vendor" / name
    if not path.exists():
        raise SystemExit("Missing pinned offline dependency: " + str(path))
    pieces.append(path.read_text(encoding="utf-8"))
for name in ["ringside-tests.js", "ringside-scoring.js", "ringside-model.js", "ringside-acquisition.js", "ringside-evaluation.js", "ringside-store.js", "ringside-interventions.js", "ringside-viz.js", "ringside-report.js", "ringside-ai-settings.js", "ringside-settings.js", "ringside-pdf.js", "ringside-picker.js", "ringside-excel.js", "ringside-excel-v3.js", "ringside-profile.js", "ringside-context-ui.js", "ringside-management.js", "ringside-entry-session.js", "ringside-fvp-entry.js", "ringside-sprint-fvp-entry.js", "ringside-excel-flow.js", "ringside-app.js"]:
    path = SRC / name
    subprocess.run(["node", "--check", str(path)], check=True)
    pieces.append(path.read_text(encoding="utf-8"))
shell = (SRC / "ringside-shell.html").read_text(encoding="utf-8")
assert shell.count("<!-- RINGSIDE_STYLES -->") == 1
styles = ["ringside.css", "ringside-workflow.css", "ringside-management-refinement.css", "ringside-report-refinement.css", "ringside-excel.css", "ringside-fvp.css"]
shell = shell.replace("<!-- RINGSIDE_STYLES -->", "<style>\n" + "\n".join((SRC / name).read_text(encoding="utf-8") for name in styles) + "\n</style>")
assert shell.count("<!-- RINGSIDE_SCRIPTS -->") == 1
script_tags = "\n".join("<script>\n" + code.replace("</script", "<\\/script") + "\n</script>" for code in pieces)
result = shell.replace("<!-- RINGSIDE_SCRIPTS -->", script_tags)
destination = ROOT / "MotionBench.html"
# Use identical artifact bytes on Windows and Linux; source newlines normalize on read.
destination.write_bytes(result.encode("utf-8"))
# The retired root alias stays absent; the daily entry URL is MotionBench.html.
print(f"Built {destination.name}: {destination.stat().st_size:,} bytes; {len(pieces)} offline scripts")
