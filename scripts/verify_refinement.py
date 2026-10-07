"""Bind the approved 2.9.0 acceptance to the exact offline artifact."""
from pathlib import Path
import hashlib
import json
import re

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
evidence = {}

def read(name, relative):
    path = ROOT / relative
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["sourceHash"] == source_hash, "Stale evidence: " + relative
    evidence[name] = {"path": relative, "sha256": digest(path)}
    return data

def files(items):
    assert items
    for item in items:
        assert digest(ROOT / item["path"]) == item["sha256"], item["path"]

unit = read("unit", "output/tests/unit-results.json")
expected = {"model-tests.cjs", "force-model-tests.cjs", "viz-tests.cjs", "workflow-model-tests.cjs", "core-model-tests.cjs", "report-v2-model-tests.cjs", "chart-ai-model-tests.cjs", "repeat-model-tests.cjs", "management-model-tests.cjs", "imtp-standards-model-tests.cjs", "report-refinement-model-tests.cjs"}
assert {s["name"] for s in unit["suites"]} == expected
assert all(s["exitCode"] == 0 and s["checksPassed"] > 0 for s in unit["suites"])
checks = sum(s["checksPassed"] for s in unit["suites"])
workflow_checks = 0
capacity = {}
for channel in ["chrome", "msedge"]:
    flow = read(channel + "Workflow", f"output/playwright/refinement/{channel}-workflow.json")
    assert flow["pass"] and len(flow["checks"]) >= 10 and not flow["errors"] and not flow["network"]
    files(flow["images"]); files(flow["downloads"])
    workflow_checks += len(flow["checks"])
    races = read(channel + "Races", f"output/playwright/refinement-races/{channel}-races.json")
    assert races["pass"] and len(races["checks"]) >= 5 and not races["errors"]
    workflow_checks += len(races["checks"])
    management = read(channel + "Management", f"output/playwright/management/{channel}-workflow.json")
    assert management["pass"] and len(management["checks"]) >= 14 and not management["errors"] and not management["network"]
    workflow_checks += len(management["checks"])
    refined = read(channel + "ManagementRefinement", f"output/playwright/management-refinement/{channel}-browser.json")
    assert refined["pass"] and len(refined["checks"]) >= 7 and not refined["errors"]
    workflow_checks += len(refined["checks"])
    cap = read(channel + "Capacity", f"output/playwright/management/{channel}-capacity.json")
    assert cap["pass"] and cap["synthetic"] and not cap["errors"]
    assert cap["athletes"] == 300 and cap["records"] == 3000
    assert cap["before"] == cap["after"] and cap["before"]["count"] == 3000
    assert cap["allEntitiesExact"] and cap["allEntitiesRoundtrip"]["counts"] == {"config": 1, "group": 10, "profile": 1, "athlete": 300, "record": 3000}
    assert cap["backupBytes"] > 50 * 1024 * 1024
    timing = cap["timings"]
    assert max(timing["startupMs"]) <= 3000 and max(timing["searchMs"]) <= 300
    assert timing["openMs"] <= 1000 and timing["saveMs"] <= 1000
    capacity[channel] = {k: cap[k] for k in ["athletes", "records", "timings", "backupBytes", "allEntitiesRoundtrip"]}

for name, minimum in [("admin", 5), ("resilience", 13)]:
    data = read(name, f"output/playwright/management/{name}.json")
    assert data["pass"] and len(data["checks"]) >= minimum and not data["errors"]
    workflow_checks += len(data["checks"])
layouts = read("managementLayouts", "output/playwright/management/visual-layouts.json")
assert layouts["pass"] and not layouts["errors"] and len(layouts["layouts"]) >= 21
assert all(not row["overflow"] for row in layouts["layouts"])
files(layouts["images"])
speed = read("trainingSpeed", "output/playwright/speed-reference-results.json")
assert speed["pass"] and all(row["pass"] for row in speed["tests"]) and len(speed["tests"]) >= 6 and not speed["errors"] and not speed["network"]
files(speed["imageHashes"])
restart = read("restart", "output/playwright/management/restart.json")
assert restart["pass"] and {c["channel"] for c in restart["cases"]} == {"chrome", "msedge"}
assert all(c["pass"] and not c["errors"] and c["listReadyMs"] <= 3000 for c in restart["cases"])

pdf = read("pdfDownloads", "output/pdf/management-download-verification.json")
render = read("pdfRender", "output/pdf/management-render-verification.json")
assert pdf["pass"] and render["pass"] and len(pdf["cases"]) == len(render["cases"]) == 5
assert any(c.get("failureRecovered") for c in pdf["cases"])
for case in pdf["cases"]:
    assert case["pass"] and not case["errors"] and not case["network"]
    for key in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
        assert not case["diagnostics"][key]
for case in render["cases"]:
    assert case["pdfSha256"] == digest(ROOT / "output/pdf" / (case["id"] + ".pdf"))
    assert all(p["a4"] and p["bodyInkPixels"] > 0 for p in case["pageChecks"])

report = read("reportRefinement", "output/report-refinement/verification.json")
assert report["pass"] and len(report["cases"]) == 3
for case in report["cases"]:
    assert case["sourceHash"] == source_hash and case["pass"] and not case["errors"]
    files(case["renderedPages"])
    assert case["pdfHash"] == digest(ROOT / "output/report-refinement" / (case["id"] + ".pdf"))
report_visual = read("reportVisual", "output/report-refinement/visual-review.json")
assert report_visual["pass"] and report_visual["reviewedPdfPages"] == sum(len(c["pages"]) for c in report["cases"])
for case in report_visual["cases"]:
    assert case["allPagesVisuallyReviewed"]
    files(case["pages"])

visual = read("visualReview", "output/playwright/refinement/visual-review.json")
assert visual["pass"] and not visual["issues"]
files(visual["images"])
pages = sum(c["pages"] for c in render["cases"]) + sum(len(c["pages"]) for c in report["cases"])
assert visual["totalPDFPages"] == pages
assert visual["reviewedUniquePages"] + visual["pixelIdenticalPages"] == pages
result = {
    "pass": True, "implementationComplete": True, "approvedAcceptancePass": True,
    "version": "2.9.0", "approvedRevision": "MB-20261007-WORKFLOW-REPORT",
    "html": artifact.name, "sha256": source_hash, "bytes": artifact.stat().st_size,
    "reproducibleBuild": True, "sourceModules": {p.name: digest(p) for p in sorted((ROOT / "src").glob("*")) if p.is_file()},
    "evidence": evidence, "modelChecks": checks, "browserWorkflowChecks": workflow_checks,
    "trainingSpeedBrowserChecks": len(speed["tests"]), "managementResponsiveLayouts": len(layouts["layouts"]),
    "capacity": capacity, "browserRestart": restart["cases"], "pdfPagesChecked": pages,
    "uniquePDFPagesVisuallyReviewed": visual["reviewedUniquePages"],
    "verificationLimits": ["Synthetic data in isolated Windows Chrome and Edge; no personal browser profiles used.", "Mobile layout was checked with browser sizes; no physical mobile or printer acceptance.", "AI fact consistency and stale-result protection were checked locally; no new live-provider content-quality claim.", "Local delivery only; no GitHub publishing performed."]
}
for relative in ["output/acceptance-manifest.json", "docs/acceptance-2.9.0.json"]:
    (ROOT / relative).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"PASS 2.9.0: {checks} model checks, {workflow_checks} browser checks, Chrome/Edge 300/3000 backup and restart, {pages} PDF pages")
