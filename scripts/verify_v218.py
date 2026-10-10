"""Verify 2.18.0 source, exact standalone artifact and its final evidence."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def read(relative):
    return json.loads((ROOT / relative).read_text(encoding="utf-8-sig"))
def evidence_data(evidence):
    assert digest(ROOT / evidence["path"]) == evidence["sha256"], evidence["path"]
    return read(evidence["path"])
def render_path(value):
    # Renderer manifests retain their original absolute paths; locate their
    # unchanged files in the current checkout when evidence is unpacked elsewhere.
    normalized = value.replace("\\", "/")
    if "/output/" in normalized:
        return ROOT / "output" / normalized.split("/output/", 1)[1]
    return Path(value)

acceptance = read("docs/acceptance-2.18.0-local.json")
assert acceptance["version"] == read("package.json")["version"] == "2.18.0-local"
artifact = acceptance["artifact"]
assert digest(ROOT / artifact["path"]) == artifact["sha256"]
assert (ROOT / artifact["path"]).stat().st_size == artifact["bytes"]
assert digest(ROOT / "Ringside_Boxing_Assessment.html") == artifact["sha256"]
subprocess.run([sys.executable, str(ROOT / "scripts/build.py")], cwd=ROOT, check=True)
assert digest(ROOT / artifact["path"]) == artifact["sha256"], "Build differs from tested artifact"
html = (ROOT / artifact["path"]).read_text(encoding="utf-8")
assert re.search(r'<script id="embedded-data" type="application/json">\s*null\s*</script>', html)
assert not re.search(r"sk-[A-Za-z0-9_-]{32,}", html)
for relative, expected in acceptance["sourceHashes"].items():
    assert digest(ROOT / relative) == expected, relative
unit = evidence_data(acceptance["unit"])
assert unit["sourceHash"] == artifact["sha256"] and unit["sourceUnchanged"]
assert len(unit["suites"]) == acceptance["unit"]["suites"]
assert digest(ROOT / "tests/run-unit-tests.cjs") == unit["runnerSha256"]
assert sum(s["checksPassed"] for s in unit["suites"]) == acceptance["unit"]["checks"]
assert all(s["exitCode"] == 0 and s["sourceUnchanged"] for s in unit["suites"])
for name, expected in unit["modules"].items():
    assert digest(ROOT / "src" / name) == expected, name
for suite in unit["suites"]:
    assert digest(ROOT / "tests" / suite["name"]) == suite["sha256"]
for evidence in acceptance["browsers"]:
    result = evidence_data(evidence)
    assert result["pass"] and result["sourceUnchanged"]
    assert result["sourceSha256"] == artifact["sha256"]
    assert len(result["checks"]) == evidence["checks"]
    assert not result["errors"] and not result["network"] and not result["failures"]
    assert digest(ROOT / "tests/dual-elasticity-browser-tests.cjs") == result["runnerSha256"]
    assert digest(ROOT / "tests/fixtures/three-fvp-regions.json") == result["fixtureSha256"]
    assert sorted(item["width"] for item in result["layouts"]) == [390, 900, 1280, 1440]
    assert len(result["pdfs"]) == 3
    for item in result["artifacts"]:
        assert digest(ROOT / item["path"]) == item["sha256"], item["path"]
    for pdf in result["pdfs"]:
        assert pdf["diagnostics"]["status"] == "complete"
        for key in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
            assert not pdf["diagnostics"][key]
        assert not any(page["overflow"] for page in pdf["pages"])
for evidence in acceptance["visualReviews"]:
    review = evidence_data(evidence)
    assert review["pass"] and review["artifactSha256"] == artifact["sha256"]
    if "pdfPath" in review:
        assert digest(ROOT / review["pdfPath"]) == review["pdfSha256"]
        assert review["pagesReviewed"] == list(range(1, len(review["artifacts"]) + 1))
    for item in review["artifacts"]:
        assert digest(ROOT / item["path"]) == item["sha256"], item["path"]
for evidence in acceptance["pdfRenders"]:
    render = evidence_data(evidence)
    assert digest(render_path(render["pdf"])) == render["pdfSha256"]
    assert len(render["pages"]) == evidence["pages"]
    for page in render["pages"]:
        assert digest(render_path(page["png"])) == page["sha256"]
        assert page["inkBounds"] is not None
        assert abs(page["pdfPointSize"][0] - 595.28) < 0.1
        assert abs(page["pdfPointSize"][1] - 841.89) < 0.1
comparison = evidence_data(acceptance["pdfCrossBrowserComparison"])
assert comparison["pass"] and comparison["artifactSha256"] == artifact["sha256"]
assert len(comparison["pairs"]) == 77
for pair in comparison["pairs"]:
    for channel in ["chrome", "msedge"]:
        assert digest(ROOT / pair[channel]["path"]) == pair[channel]["sha256"]
    assert pair["identical"] == (pair["chrome"]["sha256"] == pair["msedge"]["sha256"])
for pdf in comparison["pdfs"]:
    assert digest(ROOT / pdf["path"]) == pdf["sha256"]
assert acceptance["status"] == "passed"
print(json.dumps({"version": acceptance["version"], "sha256": artifact["sha256"],
                  "unitSuites": len(unit["suites"]), "unitChecks": sum(s["checksPassed"] for s in unit["suites"]),
                  "browsers": len(acceptance["browsers"]), "pdfs": len(acceptance["pdfRenders"]),
                  "result": "verified"}, ensure_ascii=False))
