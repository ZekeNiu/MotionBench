"""Bind MotionBench 2.12 acceptance to the delivered offline artifact."""
from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


artifact = ROOT / "MotionBench.html"
source_hash = digest(artifact)
assert source_hash == digest(ROOT / "Ringside_Boxing_Assessment.html")
html = artifact.read_text(encoding="utf-8")
assert re.search(r'<script id="embedded-data" type="application/json">\s*null\s*</script>', html)
for path in (ROOT / "src").glob("*.css"):
    assert path.read_text(encoding="utf-8") in html, path.name
# Rebuild here so reproducibility is checked rather than inferred.
subprocess.run(["python", "scripts/build.py"], cwd=ROOT, check=True, capture_output=True)
assert digest(artifact) == source_hash == digest(ROOT / "Ringside_Boxing_Assessment.html")
evidence = {}


def read(name, relative):
    path = ROOT / relative
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["sourceHash"] == source_hash, "Stale evidence: " + relative
    evidence[name] = {"path": relative, "sha256": digest(path)}
    return data


def files(items):
    for item in items:
        assert digest(ROOT / item["path"]) == item["sha256"], item["path"]


def clean(data):
    assert data["pass"] and not data.get("errors") and not data.get("network"), data.get("failure")
    files(data.get("images", []))


unit = read("unit", "output/tests/unit-results.json")
assert len(unit["suites"]) == 18
assert all(s["exitCode"] == 0 and s["checksPassed"] > 0 for s in unit["suites"])
model_checks = sum(s["checksPassed"] for s in unit["suites"])
browser_checks = 0
for channel in ["chrome", "msedge"]:
    for name, relative, minimum in [
        ("Entry", f"output/v212-entry/{channel}-results.json", 10),
        ("Reference", f"output/playwright/cpet-reference/{channel}-reference-browser.json", 6),
        ("Capability", f"output/playwright/v212-capability/{channel}-results.json", 6),
        ("Workflow", f"output/playwright/refinement/{channel}-workflow.json", 9),
        ("Races", f"output/playwright/refinement-races/{channel}-races.json", 4),
    ]:
        data = read(channel + name, relative)
        clean(data)
        assert len(data["checks"]) >= minimum, relative
        browser_checks += len(data["checks"])
        assert all(not item.get("pageOverflow") and not item.get("overflows") and not item.get("misordered") for item in data.get("layouts", []))
        if "pdf" in data:
            pdf = data["pdf"]
            files([pdf])
            assert all(not page["overflow"] for page in pdf["pages"])
            for key in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
                assert not pdf["diagnostics"][key], key
        if channel == "chrome" and name == "Capability":
            assert len(data["checks"]) >= 8 and data["stress"]["unchanged"]
            assert all(not page["overflow"] for page in data["stress"]["pages"])
resilience = read("managementResilience", "output/playwright/management/resilience.json")
clean(resilience)
browser_checks += len(resilience["checks"])
visual = read("pdfVisual", "output/playwright/v212-capability/pdf-review.json")
clean(visual)
files([visual["pdf"]])
files(visual["renderedPages"])
assert visual["reviewedPages"] == visual["totalPages"] == len(visual["renderedPages"])
source_path = ROOT / "output/playwright/cpet-reference/friend-source-verification.json"
source = json.loads(source_path.read_text(encoding="utf-8"))
assert source["pass"] and source["groups"] == 28 and source["percentileValuesCompared"] == 532
evidence["friendSourceVerification"] = {"path": source_path.relative_to(ROOT).as_posix(), "sha256": digest(source_path)}
result = {
    "pass": True, "version": "2.12.0",
    "acceptanceScope": "Four capability cards, CPET and reference editing, migration, real entry and persistence, backup/export, responsive report and actual PDF.",
    "html": artifact.name, "sha256": source_hash, "bytes": artifact.stat().st_size,
    "reproducibleBuild": True,
    "sourceModules": {p.relative_to(ROOT).as_posix(): digest(p) for p in sorted((ROOT / "src").glob("*")) if p.is_file()},
    "evidence": evidence, "modelChecks": model_checks, "browserChecks": browser_checks,
    "pdfPagesVisuallyReviewed": visual["reviewedPages"],
    "rollback": {"tag": "v2.11.0", "htmlSHA256": "9cf99b5fd0985dd10811721e667d53846d8eee1569cb3a21bc4be77ec972dcb2"},
    "verificationLimits": [
        "Synthetic measurements and isolated Chrome/Edge profiles; no personal athlete records used.",
        "Narrow-screen layout uses browser viewports; no physical phone, test device or printer acceptance.",
        "Local server and online AI provider were not changed or revalidated in this release.",
        "Training priority follows configured goals; software verification does not establish individual training efficacy.",
    ],
}
for relative in ["output/acceptance-manifest.json", "docs/acceptance-2.12.0.json"]:
    (ROOT / relative).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"PASS 2.12.0: {model_checks} model, {browser_checks} browser checks; {visual['reviewedPages']} PDF pages")
print(source_hash)
