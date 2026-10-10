"""Verify, or record after verification, the exact 2.19.0 delivery evidence."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "docs/acceptance-2.19.0.json"
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def read(relative):
    return json.loads((ROOT / relative).read_text(encoding="utf-8-sig"))
def evidence(relative):
    return {"path": relative, "sha256": digest(ROOT / relative)}
def verify_files(items):
    for item in items:
        assert digest(ROOT / item["path"]) == item["sha256"], item["path"]

assert read("package.json")["version"] == "2.19.0"
artifact = ROOT / "MotionBench.html"
source_hash = digest(artifact)
subprocess.run([sys.executable, str(ROOT / "scripts/build.py")], cwd=ROOT, check=True)
assert digest(artifact) == source_hash, "Build changed the tested HTML"
assert not (ROOT / "Ringside_Boxing_Assessment.html").exists(), "Retired entry was recreated"
html = artifact.read_text(encoding="utf-8")
assert re.search(r'<script id="embedded-data" type="application/json">\s*null\s*</script>', html)
assert not re.search(r"sk-[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{30,}", html)
source_files = sorted((ROOT / "src").glob("*")) + [ROOT / "scripts/build.py", ROOT / "package.json", ROOT / "vendor/versions.json"]
source_hashes = {p.relative_to(ROOT).as_posix(): digest(p) for p in source_files if p.is_file()}

unit_path = "output/tests/v2.19.0/unit-results.json"
unit = read(unit_path)
assert unit["sourceHash"] == source_hash and unit["sourceUnchanged"]
assert len(unit["suites"]) == 50
assert digest(ROOT / "tests/run-unit-tests.cjs") == unit["runnerSha256"]
for name, expected in unit["modules"].items():
    assert digest(ROOT / "src" / name) == expected
for suite in unit["suites"]:
    assert suite["exitCode"] == 0 and suite["sourceUnchanged"]
    assert digest(ROOT / "tests" / suite["name"]) == suite["sha256"]
checks = sum(s["checksPassed"] for s in unit["suites"])

browser_specs = [
    ("management", "output/playwright/management-v219/{channel}-results.json", "management-v219-browser-tests.cjs", 11),
    ("management-faults", "output/playwright/management-v219/{channel}-fault-results.json", "management-v219-fault-browser-tests.cjs", 11),
    ("acquisition", "output/tests/v219-acquisition-browser/{channel}-results.json", "acquisition-v219-browser-tests.cjs", 7),
    ("storage", "output/playwright/v2.19.0/storage/{channel}.json", "storage-v219-browser-tests.cjs", 8),
    ("report", "output/playwright/v2.19.0/report/{channel}-results.json", "dual-elasticity-browser-tests.cjs", 18),
    ("mean-report", "output/playwright/v2.19.0/scoring-report/{channel}.json", "report-v219-browser-tests.cjs", 4),
]
browsers = []
for name, pattern, runner, count in browser_specs:
    for channel in ["chrome", "msedge"]:
        relative = pattern.format(channel=channel)
        data = read(relative)
        assert data["pass"] and data["sourceUnchanged"], relative
        assert data.get("sourceHash", data.get("sourceSha256", data.get("htmlSha256"))) == source_hash, relative
        assert data["runnerSha256"] == digest(ROOT / "tests" / runner), runner
        assert not data["errors"] and not data["network"] and not data.get("failure") and not data.get("failures"), relative
        assert len(data["checks"]) == count, (name, len(data["checks"]), count)
        verify_files(data.get("artifacts", []))
        verify_files(data.get("screenshots", []))
        for pdf in data.get("pdfs", []):
            assert digest(ROOT / pdf["file"]) == pdf["sha256"]
            diagnostics = pdf["diagnostics"]
            assert diagnostics["status"] == "complete"
            for key in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
                assert not diagnostics[key]
            assert not any(p.get("overflow") for p in pdf["pages"])
        browsers.append({"name": name, "channel": channel, "checks": count, **evidence(relative)})

native_path = "output/tests/v219-excel-native/evidence.json"
native = read(native_path)
assert native["pass"] and native["sourceHash"] == source_hash
for name, expected in native["sourceHashes"].items():
    assert digest(ROOT / "src" / ("ringside-" + name + ".js")) == expected
for name, expected in native["runnerHashes"].items():
    assert digest(ROOT / "tests" / name) == expected
assert native["inputSha256"] == digest(ROOT / "output/tests/v219-excel-native/input.xlsx")
assert native["outputSha256"] == digest(ROOT / "output/tests/v219-excel-native/excel-saved.xlsx")
assert native["excel"]["independentInstance"]

renders_path = "output/pdf/v2.19.0/renders.json"
renders = read(renders_path)
assert renders["pass"] and renders["sourceHash"] == source_hash and len(renders["cases"]) == 8
for case in renders["cases"]:
    verify_files([case["pdf"], *case["pages"], *case["contacts"]])
    assert case["pages"] and all(p["a4"] and p["bodyNonblank"] for p in case["pages"])
visual_path = "output/pdf/v2.19.0/visual-review.json"
visual = read(visual_path)
assert visual["pass"] and visual["sourceHash"] == source_hash
verify_files(visual["artifacts"])
for case in renders["cases"]:
    entry = next(v for v in visual["cases"] if (v["group"], v["channel"], v["index"]) == (case["group"], case["channel"], case["index"]))
    assert entry["pdfSha256"] == case["pdf"]["sha256"]
    assert entry["reviewedPages"] == [p["page"] for p in case["pages"]]
    assert entry["method"] in ["visual inspection", "pixel-identical to visually inspected pages"]
    if entry["method"].startswith("pixel-identical"):
        assert case["channel"] == "msedge"
        assert next(p for p in renders["comparisons"] if p["group"] == case["group"] and p["index"] == case["index"])["identical"]

management_visual_path = "output/playwright/management-v219/management-visual-review.json"
management_visual = read(management_visual_path)
assert management_visual["pass"] and management_visual["sourceHash"] == source_hash
assert len(management_visual["screenshots"]) >= 6
verify_files(management_visual["screenshots"])

data = {"version": "2.19.0", "status": "passed", "artifact": {"path": "MotionBench.html", "sha256": source_hash, "bytes": artifact.stat().st_size},
        "sourceHashes": source_hashes, "unit": {**evidence(unit_path), "suites": len(unit["suites"]), "checks": checks},
        "browsers": browsers, "nativeExcel": evidence(native_path), "pdfRenders": evidence(renders_path), "visualReview": evidence(visual_path), "managementVisualReview": evidence(management_visual_path),
        "rollback": {"tag": "rollback-v2.18.0-local-before-management-20261011", "commit": "0faaa5c1dfb9ee234faf30b751067670fdf4d9ff", "sha256": "0a72a07e322f1c083b672e8647823977b3f1d11112b1d3bd7c65165de0c04741"},
        "verificationLimits": ["Browser workflows and migrations use isolated synthetic libraries; the user's live browser library was not opened.", "Chrome and Edge ran on this Windows host; narrow screens use browser viewports rather than physical mobile devices.", "AI input and stale-result protection were checked; no live model-provider content-quality claim.", "Native Microsoft Excel was exercised on this host; other spreadsheet applications and physical printers were not tested."]}
if "--record" in sys.argv:
    data["recordedAt"] = datetime.now(timezone.utc).isoformat()
    DEST.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
else:
    saved = json.loads(DEST.read_text(encoding="utf-8"))
    saved.pop("recordedAt", None)
    assert saved == data, "Delivery manifest differs from the current source or evidence"
print(json.dumps({"version": "2.19.0", "sha256": source_hash, "modelChecks": checks, "browserChecks": sum(b["checks"] for b in browsers), "pdfPages": sum(len(c["pages"]) for c in renders["cases"]), "verified": True}))
