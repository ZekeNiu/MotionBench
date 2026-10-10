"""Verify the exact artifact using its version-specific acceptance evidence."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "Ringside_Boxing_Assessment.html"
version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
if version == "2.17.3-local":
    subprocess.run([sys.executable, str(ROOT / "scripts/verify_v2173_charts.py")], cwd=ROOT, check=True)
    sys.exit(0)
if version in {"2.17.0-local", "2.17.1-local", "2.17.2-local"}:
    subprocess.run([sys.executable, str(ROOT / "scripts/verify_v217_local.py")], cwd=ROOT, check=True)
    sys.exit(0)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

source_hash = digest(HTML)
subprocess.run([sys.executable, str(ROOT / "scripts/build.py")], cwd=ROOT, check=True)
assert digest(HTML) == source_hash, "Build changed the tested artifact"
html = HTML.read_text(encoding="utf-8")
modules = {}
for path in sorted((ROOT / "src").glob("*.js")):
    code = path.read_text(encoding="utf-8").replace("</script", "<\\/script")
    assert "<script>\n" + code + "\n</script>" in html, path.name
    modules[path.name] = digest(path)
assert not re.search(r"sk-[A-Za-z0-9_-]{32,}", html)
evidence = {}

def read(name, relative):
    path = ROOT / relative
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["sourceHash"] == source_hash, "Stale evidence: " + relative
    evidence[name] = {"path": relative, "sha256": digest(path)}
    return data

def images(items):
    assert items
    for item in items:
        assert item["sha256"] == digest(ROOT / item["path"]), item["path"]

if version == "2.16.1":
    subprocess.run([sys.executable, str(ROOT / "scripts/verify_v2161.py")], cwd=ROOT, check=True)
    sys.exit(0)
if version == "2.16.0":
    subprocess.run([sys.executable, str(ROOT / "scripts/verify_v216.py")], cwd=ROOT, check=True)
    sys.exit(0)
if version == "2.15.0":
    subprocess.run([sys.executable, str(ROOT / "scripts/verify_v215.py")], cwd=ROOT, check=True)
    sys.exit(0)
if version == "2.14.0":
    subprocess.run([sys.executable, str(ROOT / "scripts/verify_v214.py")], cwd=ROOT, check=True)
    sys.exit(0)
if version == "2.11.0":
    subprocess.run([sys.executable, str(ROOT / "scripts/verify_v211.py")], cwd=ROOT, check=True)
    sys.exit(0)
if version == "2.10.0":
    subprocess.run([sys.executable, str(ROOT / "scripts/verify_v210.py")], cwd=ROOT, check=True)
    sys.exit(0)
if version == "2.9.0":
    subprocess.run([sys.executable, str(ROOT / "scripts/verify_refinement.py")], cwd=ROOT, check=True)
    sys.exit(0)
unit = read("unit", "output/tests/unit-results.json")
assert len(unit["suites"]) == (9 if version == "2.8.0" else 8) and all(s["exitCode"] == 0 for s in unit["suites"])
checks = sum(s["checksPassed"] for s in unit["suites"])
assert checks == (158 if version == "2.8.0" else 148 if version in {"2.6.2", "2.6.3", "2.7.0", "2.7.1", "2.7.2"} else 146)
evidence["unit"]["checks"] = checks

if version == "2.8.0":
    assert digest(ROOT / "MotionBench.html") == source_hash
    assert re.search(r'<script id="embedded-data" type="application/json">\s*null\s*</script>', html)
    workflows = []
    capacity = {}
    for channel in ["chrome", "msedge"]:
        flow = read(channel + "Workflow", f"output/playwright/management/{channel}-workflow.json")
        assert flow["pass"] and len(flow["checks"]) == 14 and not flow["errors"] and not flow["network"]
        workflows.extend(flow["checks"])
        cap = read(channel + "Capacity", f"output/playwright/management/{channel}-capacity.json")
        assert cap["pass"] and cap["synthetic"] and not cap["errors"]
        assert cap["athletes"] == 300 and cap["records"] == 3000
        assert cap["before"] == cap["after"] and cap["before"]["count"] == 3000
        assert cap["allEntitiesExact"] and cap["allEntitiesRoundtrip"]["counts"] == {"config": 1, "group": 10, "profile": 1, "athlete": 300, "record": 3000}
        assert cap["backupBytes"] > 50 * 1024 * 1024
        timing = cap["timings"]
        assert len(timing["startupMs"]) == len(timing["searchMs"]) == 3
        assert max(timing["startupMs"]) <= 3000 and max(timing["searchMs"]) <= 300
        assert timing["openMs"] <= 1000 and timing["saveMs"] <= 1000
        capacity[channel] = {k: cap[k] for k in ["athletes", "records", "timings", "backupBytes", "allEntitiesRoundtrip"]}
    for name, count in [("admin", 5), ("resilience", 13)]:
        data = read(name, f"output/playwright/management/{name}.json")
        assert data["pass"] and not data["errors"] and len(data["checks"]) == count
        workflows.extend(data["checks"])
    layout = read("managementLayouts", "output/playwright/management/visual-layouts.json")
    assert layout["pass"] and not layout["errors"] and len(layout["layouts"]) == 18
    assert all(not row["overflow"] for row in layout["layouts"])
    images(layout["images"])
    restart = read("browserRestart", "output/playwright/management/restart.json")
    assert restart["pass"] and {c["channel"] for c in restart["cases"]} == {"chrome", "msedge"}
    assert all(c["pass"] and not c["errors"] and c["listReadyMs"] <= 3000 for c in restart["cases"])
    pdf = read("pdfDownloads", "output/pdf/management-download-verification.json")
    render = read("pdfRender", "output/pdf/management-render-verification.json")
    visual = read("visualReview", "output/playwright/management/visual-review.json")
    assert pdf["pass"] and render["pass"] and visual["pass"]
    assert len(pdf["cases"]) == len(render["cases"]) == 5
    assert any(c.get("failureRecovered") for c in pdf["cases"])
    for case in pdf["cases"]:
        assert case["pass"] and not case["errors"] and not case["network"] and case["pdfTarget"] == 80
        for field in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
            assert not case["diagnostics"][field]
        assert all(not figure["outside"] for figure in case["figures"])
    for case in render["cases"]:
        assert case["pdfSha256"] == digest(ROOT / "output/pdf" / (case["id"] + ".pdf"))
        assert all(p["a4"] and p["bodyInkPixels"] > 0 for p in case["pageChecks"])
    pages = sum(c["pages"] for c in render["cases"])
    assert visual["pages"] == pages and visual["uniquePagesVisuallyReviewed"] == 31
    assert len(visual["identicalPixelCases"]) == 3 and all(visual["identicalPixelCases"].values())
    images(visual["images"])
    result = {"pass": True, "implementationComplete": True, "approvedAcceptancePass": True,
        "version": version, "approvedRevision": "MB-20261007-MANAGEMENT", "html": HTML.name,
        "sha256": source_hash, "bytes": HTML.stat().st_size, "reproducibleBuild": True,
        "modules": modules, "evidence": evidence, "modelChecks": checks, "browserWorkflowChecks": len(workflows),
        "capacity": capacity, "browserRestart": restart["cases"], "pdfPagesChecked": pages, "uniquePDFPagesVisuallyReviewed": 31,
        "scope": "Separate report workspace and management center; live shared evaluation profiles; IndexedDB migration, streamed backups, teams, archive and recycle bin.",
        "rollback": {"tag": "v2.7.2", "commit": "bfa9164c3110f7d1e24e65648a0a6c5f237c3ef9", "use": "Pre-migration backup, or tested v2-compatible JSON without new management fields."},
        "verificationLimits": ["Capacity data are synthetic. Timings describe this Windows host and isolated installed Chrome/Edge browsers, not every device.", "AI facts and stale-task protection were tested with synthetic responses; no new live-provider content-quality claim.", "Mobile layout uses browser emulation; physical mobile devices and printing were not tested."]}
    (ROOT / "output/acceptance-manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"PASS 2.8.0: {checks} model checks, {len(workflows)} browser checks, Chrome/Edge 300/3000, {pages} PDF pages")
    print(source_hash)
    raise SystemExit(0)

if version == "2.7.2":
    assert digest(ROOT / "MotionBench.html") == source_hash
    layout = read("isometricLayout", "output/playwright/iso-layout/review.json")
    comparison = read("comparison", "output/playwright/iso-compact/comparison/review.json")
    pdf = read("pdfDownloads", "output/pdf/iso-layout-download-verification.json")
    render = read("pdfRender", "output/pdf/iso-compact-render-verification.json")
    visual = read("visualReview", "output/playwright/iso-compact/visual-review.json")
    failure = read("pdfFailure", "output/pdf/failure-ui-verification.json")
    for item in [layout, comparison, pdf, render, visual, failure]:
        assert item["pass"] and not item.get("errors")
    assert len(layout["checks"]) == 5 and not layout["network"]
    normal = [x for x in layout["layouts"] if x["scenario"] == "demo"]
    assert {x["viewport"] for x in normal} == {1920, 1440, 1366, 1280, 900, 390}
    for row in layout["layouts"]:
        assert not row["pageOverflow"] and not row["brokenNumbers"] and not row["labelsOutside"]
        assert not row["misalignedSides"] and row["font"] == "13px"
        if row["scenario"] != "stress":
            assert not row["localScroll"]
        if row["scenario"] == "demo":
            assert row["peers"] and all(abs(p["x"] - row["table"]["x"]) < 1 and abs(p["width"] - row["table"]["width"]) < 1 for p in row["peers"])
    images(layout["images"])
    images(layout["downloads"])
    assert len(comparison["comparisons"]) == 4 and all(x["equal"] for x in comparison["comparisons"])
    assert len(comparison["images"]) == 6
    images(comparison["images"])
    baseline = ROOT / "output/backups/iso-labels-20261007"
    assert digest(baseline / "MotionBench.html") == comparison["baselineHash"]
    unchanged = {}
    for name in ["ringside-calc.js", "ringside-definitions.js", "ringside-model.js", "ringside-tests.js", "ringside-interventions.js", "ringside-viz.js", "ringside-app.js"]:
        unchanged[name] = digest(ROOT / "src" / name)
        assert unchanged[name] == digest(baseline / "src" / name), name
    assert len(pdf["cases"]) == len(render["cases"]) == 7 and pdf["foldAndViewportIndependent"]
    assert {c["mode"] for c in pdf["cases"]} == {"side-by-side", "stacked"}
    for case in pdf["cases"]:
        assert case["pass"] and case["pdfSha256"] == digest(ROOT / "output/pdf" / (case["id"] + ".pdf"))
        for field in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
            assert not case["diagnostics"][field]
        decision = case["diagnostics"]["isometricLayouts"][0]
        assert (case["mode"] == "side-by-side") == (decision["sideBySideHeight"] <= decision["capacity"])
        assert all(not p["overflow"] and not p["brokenNumbers"] and not p["misalignedSides"] for p in case["pages"])
        assert all(p["rowColors"] == ["rgb(255, 255, 255)"] or not p["rowColors"] for p in case["pages"])
        assert all(t["font"] == "12px" for p in case["pages"] for t in p["iso"])
    for case in render["cases"]:
        assert case["pdfSha256"] == digest(ROOT / "output/pdf" / (case["id"] + ".pdf"))
        assert all(p["a4"] for p in case["pageChecks"])
    assert visual["allPagesVisuallyReviewed"] and visual["allComparisonPairsReviewed"]
    assert visual["sameRecordDesktopMobilePixelsEqual"]
    images(visual["images"])
    assert visual["pages"] == sum(c["pages"] for c in render["cases"])
    assert {(c["id"], p) for c in render["cases"] for p in range(1, c["pages"] + 1)} == {(c["id"], p) for c in visual["pdfCases"] for p in c["reviewedPages"]}
    result = {"pass": True, "version": version, "html": "MotionBench.html", "sha256": source_hash,
        "bytes": (ROOT / "MotionBench.html").stat().st_size, "reproducibleBuild": True,
        "modules": modules, "unchangedCalculationAndInteractionModules": unchanged, "evidence": evidence,
        "modelChecks": checks, "isometricLayoutGroups": 5, "widths": 6,
        "sameDataComparisons": 4, "visualComparisonPairs": 3,
        "pdfFilesReviewed": 7, "pdfPagesReviewed": visual["pages"], "rollbackTag": "v2.7.1",
        "confidence": "high", "verificationLimits": [
            "Targeted isometric display and PDF regression; earlier AI/sidebar evidence remains specific to version 2.7.1.",
            "Extreme custom values can require scrolling inside the table; standard and configured-grade fixtures fit at tested widths.",
            "Mobile checks use browser viewport simulation; physical devices and paper printing were not tested."]}
    (ROOT / "output/acceptance-manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    public = {k: v for k, v in result.items() if k not in {"evidence", "modules"}}
    (ROOT / "docs/acceptance-2.7.2.json").write_text(json.dumps(public, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("PASS MotionBench 2.7.2: compact labels, aligned tables, unchanged data and current-artifact PDF review")
    print(source_hash)
    raise SystemExit(0)

if version == "2.7.1":
    assert digest(ROOT / "MotionBench.html") == source_hash
    scope = read("aiScope", "output/playwright/silver-ui/ai-scope.json")
    sidebar = read("sidebar", "output/playwright/silver-ui/sidebar.json")
    comparison = read("comparison", "output/playwright/silver-ui/comparison/review.json")
    ai = read("aiUI", "output/ai/motionbench/browser-results.json")
    narrative = read("narrative", "output/ai/narrative-flow.json")
    layout = read("isometricLayout", "output/playwright/iso-layout/review.json")
    workflow = read("workflow", "output/playwright/workflow-verification-results.json")
    pdf = read("pdfDownloads", "output/pdf/silver-download-verification.json")
    render = read("pdfRender", "output/pdf/silver-render-verification.json")
    visual = read("visualReview", "output/playwright/silver-ui/visual-review.json")
    failure = read("pdfFailure", "output/pdf/failure-ui-verification.json")
    for item in [scope, sidebar, comparison, ai, narrative, layout, pdf, render, visual, failure]:
        assert item["pass"]
        assert not item.get("errors")
    assert len(scope["checks"]) == 11 and scope["synthetic"] and not scope["liveQualityEvidence"]
    assert len(sidebar["checks"]) == 9 and not sidebar["network"]
    assert {(1366, 768), (390, 667), (844, 390)} <= {(x["width"], x["height"]) for x in sidebar["layouts"]}
    assert all(not x["pageOverflow"] and x["cards"] == 4 for x in sidebar["layouts"])
    assert workflow["passed"] == 24 and workflow["failed"] == 0 and not workflow["browserErrors"]
    assert len(ai["checks"]) == 9 and len(layout["checks"]) == 4 and not layout["network"]
    assert len(comparison["comparisons"]) == 4 and all(x["equal"] for x in comparison["comparisons"])
    assert len(comparison["images"]) == 20
    images(comparison["images"])
    baseline = ROOT / "output/backups/silver-ai-sidebar-20261007"
    assert digest(baseline / "MotionBench.html") == comparison["baselineHash"]
    unchanged = {}
    for name in ["ringside-calc.js", "ringside-definitions.js", "ringside-model.js", "ringside-tests.js", "ringside-interventions.js", "ringside-report.js"]:
        unchanged[name] = digest(ROOT / "src" / name)
        assert unchanged[name] == digest(baseline / "src" / name), name
    for case in pdf["cases"]:
        assert case["pass"] and case["pdfSha256"] == digest(ROOT / "output/pdf" / (case["id"] + ".pdf"))
        for field in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
            assert not case["diagnostics"].get(field, [])
    for case in render["cases"]:
        assert case["pdfSha256"] == digest(ROOT / "output/pdf" / (case["id"] + ".pdf"))
        assert all(p["a4"] for p in case["pageChecks"])
    assert visual["allPagesVisuallyReviewed"] and visual["allComparisonPairsReviewed"]
    images(visual["images"])
    assert visual["pages"] == sum(c["pages"] for c in render["cases"])
    assert {(c["id"], p) for c in render["cases"] for p in range(1, c["pages"] + 1)} == {
        (c["id"], p) for c in visual["pdfCases"] for p in c["reviewedPages"]}
    result = {"pass": True, "version": version, "html": "MotionBench.html", "sha256": source_hash,
        "bytes": (ROOT / "MotionBench.html").stat().st_size, "reproducibleBuild": True,
        "modules": modules, "unchangedCalculationAndReportModules": unchanged, "evidence": evidence,
        "modelChecks": checks, "aiScopeWorkflows": 11, "aiServiceWorkflows": 9,
        "sidebarViewportScenarios": 9, "coreWorkflows": 24, "isometricLayoutGroups": 4,
        "sameDataComparisons": 4, "visualComparisonPairs": 10,
        "pdfFilesReviewed": len(render["cases"]), "pdfPagesReviewed": visual["pages"],
        "confidence": "high", "verificationLimits": [
            "AI lifecycle checks use intercepted synthetic responses; no new live-model quality claim.",
            "Mobile checks use browser viewport simulation; physical devices and paper printing were not tested.",
            "This is a local update; no new remote release was published."]}
    (ROOT / "output/acceptance-manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    public = {k: v for k, v in result.items() if k not in {"evidence", "modules"}}
    (ROOT / "docs/acceptance-2.7.1.json").write_text(json.dumps(public, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("PASS MotionBench 2.7.1: current build, scoped AI, sidebar, unchanged data, workflows and visual PDF review")
    print(source_hash)
    raise SystemExit(0)

if version == "2.7.0":
    assert digest(ROOT / "MotionBench.html") == source_hash
    ai = read("aiUI", "output/ai/motionbench/browser-results.json")
    assert ai["pass"] and len(ai["checks"]) >= 8 and not ai["errors"]
    assert {x["width"] for x in ai["widths"]} == {1920, 1440, 1280, 900, 390}
    flow = read("aiNarrative", "output/ai/narrative-flow.json")
    assert flow["pass"] and not flow["errors"]
    server = read("localServer", "output/tests/local-server-results.json")
    assert server["pass"] and server["checks"] == 9 and server["serverHash"] == digest(ROOT / "scripts/serve.py")
    layout = read("isometricLayout", "output/playwright/iso-layout/review.json")
    assert layout["pass"] and len(layout["checks"]) == 4 and not layout["errors"] and not layout["network"]
    images(layout["images"])
    delivery = read("privacyAndDelivery", "output/release/delivery-verification.json")
    assert delivery["pass"] and len(delivery["checks"]) == 5 and not delivery["errors"]
    live = read("liveAI", "output/ai/motionbench/live-gpt-6.1-sol.json")
    assert live["pass"] and len(live["cases"]) == 5 and all(c["pass"] and c["applied"] and c["exportWithoutCredentials"] and c["narrativePages"]<=2 for c in live["cases"])
    quality = read("aiQuality", "output/ai/motionbench/quality-review.json")
    assert quality["reviewed"] and len(quality["cases"]) == 5
    for case in quality["cases"]:
        assert case["sha256"] == digest(ROOT / case["path"])
    pdf = read("coachingPDF", "output/pdf/motionbench-download-verification.json")
    render = read("coachingPDFRender", "output/pdf/motionbench-render-verification.json")
    visual = read("coachingPDFVisual", "output/pdf/motionbench-visual-review.json")
    assert pdf["pass"] and render["pass"] and visual["pass"] and visual["manuallyReviewed"]
    images(visual["images"])
    assert visual["pages"] == sum(c["pages"] for c in render["cases"])
    for case in pdf["cases"]:
        assert case["pdfSha256"] == digest(ROOT / "output/pdf" / (case["id"] + ".pdf"))
        for field in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
            assert not case["diagnostics"][field]
    result = {"pass": True, "version": version, "html": "MotionBench.html", "sha256": source_hash,
        "bytes": (ROOT / "MotionBench.html").stat().st_size, "reproducibleBuild": True,
        "modules": modules, "localServerSHA256": server["serverHash"], "evidence": evidence,
        "modelChecks": checks, "aiUIWorkflows": len(ai["checks"]), "privacyDeliveryWorkflows": 5,
        "localServerChecks": 9, "isometricLayoutGroups": 4, "widths": 5,
        "liveAIScenarios": 5, "liveAIModel": live["model"], "liveAITransport": live["transport"],
        "pdfPagesReviewed": visual["pages"], "deliveryConfidence": "high", "modelQualityConfidence": "medium",
        "verificationLimits": ["Limited synthetic real-model sample; generated advice requires coach review.", "Relay file browser preflight remains blocked; shipped local launcher tested successfully.", "Physical mobile devices, paper printing and other providers were not tested."]}
    (ROOT / "output/acceptance-manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    public = {k: v for k, v in result.items() if k not in {"evidence", "modules"}}
    (ROOT / "docs/acceptance-2.7.0.json").write_text(json.dumps(public, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("PASS MotionBench 2.7.0: current source, AI workflows, live model, privacy, layout and PDF")
    print(source_hash)
    raise SystemExit(0)

if version == "2.6.3":
    browser = read("isoLayoutBrowser", "output/playwright/iso-layout/review.json")
    assert browser["pass"] and not browser["errors"] and not browser["network"]
    assert len(browser["checks"]) == 4
    layouts = [row for row in browser["layouts"] if row["scenario"] == "demo"]
    assert {1920, 1440, 1280, 900, 390} == {row["viewport"] for row in layouts}
    for row in browser["layouts"]:
        assert not row["pageOverflow"] and not row["labelsOutside"] and not row["brokenNumbers"]
        assert not row["misalignedSides"] and row["font"] == "13px"
        if row["viewport"] > 600:
            assert row["chart"]["x"] + row["chart"]["width"] <= row["wrap"]["x"] + 1
            assert 299 <= row["chart"]["width"] <= 381 and row["table"]["width"] >= 719
        else:
            assert row["wrap"]["y"] >= row["chart"]["y"] + row["chart"]["height"] and not row["localScroll"]
    images(browser["images"])
    images(browser["downloads"])
    pdf = read("isoLayoutPDF", "output/pdf/iso-layout-download-verification.json")
    assert pdf["pass"] and pdf["foldAndViewportIndependent"] and len(pdf["cases"]) == 6
    assert pdf["cases"][0]["pages"] == pdf["cases"][-1]["pages"]
    assert {case["mode"] for case in pdf["cases"]} == {"side-by-side", "stacked"}
    for case in pdf["cases"]:
        assert case["pass"] and case["pdfSha256"] == digest(ROOT / "output/pdf" / (case["id"] + ".pdf"))
        for field in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
            assert not case["diagnostics"][field]
        layout = case["diagnostics"]["isometricLayouts"][0]
        assert (layout["mode"] == "side-by-side") == (layout["sideBySideHeight"] <= layout["capacity"])
        assert all(not p["overflow"] and not p["brokenNumbers"] and not p["misalignedSides"] for p in case["pages"])
        tables = [t for p in case["pages"] for t in p["iso"]]
        assert tables and all(t["font"] == "12px" for t in tables)
        assert all(all(abs(a - b) < 1 for a, b in zip(t["columns"], tables[0]["columns"])) for t in tables)
    demo = next(case for case in pdf["cases"] if case["id"] == "iso-layout-demo")
    assert sum(page["stats"] for page in demo["pages"]) == 71
    render = read("isoLayoutRender", "output/pdf/iso-layout-render-verification.json")
    assert render["pass"] and len(render["cases"]) == 6
    for case in render["cases"]:
        exported = next(c for c in pdf["cases"] if c["id"] == case["id"])
        assert case["pdfSha256"] == exported["pdfSha256"] and case["pages"] == exported["diagnostics"]["pageCount"]
        assert all(p["a4"] and p["bodyInkPixels"] > 0 for p in case["pageChecks"])
    visual = read("isoLayoutVisual", "output/pdf/iso-layout-visual-review.json")
    assert visual["pass"] and visual["manuallyReviewed"] and visual["foldAndViewportIdenticalPixels"]
    assert visual["pages"] == sum(c["pages"] for c in render["cases"])
    images(visual["images"])
    failure = read("pdfFailureRetry", "output/pdf/failure-ui-verification.json")
    assert failure["pass"] and failure["failure"]["temporaryPages"] == 0
    result = {"pass": True, "implementationComplete": True, "approvedAcceptancePass": True,
        "version": version, "approvedRevision": "RS-20261007-ISO-LAYOUT", "html": HTML.name,
        "sha256": source_hash, "bytes": HTML.stat().st_size, "reproducibleBuild": True,
        "modules": modules, "evidence": evidence, "modelChecks": checks, "focusedBrowserGroups": 4,
        "layoutWidths": 5, "pdfCases": 6, "pdfPagesReviewed": visual["pages"], "demoGroups": 56, "demoStatistics": 71,
        "scope": "Isometric content-driven seven columns with local scrolling; fixed five-axis radar; independent A4 one-page preflight and stacked table continuation.",
        "verificationLimits": ["Mobile layouts use browser emulation; no physical-device or paper-print test.", "No live AI-provider or complete historical browser workflow rerun for this display revision."]}
    (ROOT / "output/acceptance-manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"PASS 2.6.3: {checks} model checks, four focused browser groups, five widths, six PDFs / {visual['pages']} reviewed pages, failure/retry")
    print(source_hash)
    raise SystemExit(0)

if version == "2.6.2":
    browser = read("columnsBrowser", "output/playwright/repeat-columns/review.json")
    assert browser["pass"] and not browser["errors"] and not browser["network"]
    assert len(browser["checks"]) == 8
    assert {1920,1440,1280,900,390} == {row["viewport"] for row in browser["layouts"]}
    for row in browser["layouts"]:
        assert row["noOverflow"] and not row["labelsOutside"] and not row["tableOverflow"]
        assert abs(row["height"] - (290 if row["viewport"] == 390 else 390)) < 1
    images(browser["images"])
    images(browser["downloads"])
    assert browser["pdf"]["sha256"] == digest(ROOT / browser["pdf"]["path"])
    pdf = read("columnsPDF", "output/pdf/columns-download-verification.json")
    assert len(pdf["cases"]) == 1 and pdf["cases"][0]["pass"]
    case = pdf["cases"][0]
    assert case["pdfSha256"] == browser["pdf"]["sha256"]
    assert sum(page["stats"] for page in case["pages"]) == 71
    for field in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
        assert not case["diagnostics"][field]
    render = read("columnsPDFRender", "output/pdf/columns-render-verification.json")
    assert render["pass"] and render["cases"][0]["pages"] == browser["pdf"]["pages"]
    assert render["cases"][0]["pdfSha256"] == browser["pdf"]["sha256"]
    assert all(page["a4"] and page["bodyInkPixels"] > 0 for page in render["cases"][0]["pageChecks"])
    visual = read("columnsVisual", "output/pdf/columns-visual-review.json")
    assert visual["pass"] and visual["manuallyReviewed"] and visual["pages"] == browser["pdf"]["pages"]
    images(visual["images"])
    result = {"pass": True, "implementationComplete": True, "approvedAcceptancePass": True,
        "version": version, "approvedRevision": "RS-20261007-REPEAT-COLUMNS", "html": HTML.name,
        "sha256": source_hash, "bytes": HTML.stat().st_size, "reproducibleBuild": True,
        "modules": modules, "evidence": evidence, "modelChecks": checks, "focusedBrowserChecks": 8,
        "layoutWidths": 5, "pdfPagesReviewed": browser["pdf"]["pages"], "demoGroups": 56, "demoStatistics": 71,
        "scope": "Statistics in existing result tables; visible iso/IMTP repeat entry; isometric labels/size; simplified IMTP table.",
        "verificationLimits": ["Mobile layouts use browser emulation, not physical devices.", "No live AI-provider or complete historical browser workflow rerun in this display revision."]}
    (ROOT / "output/acceptance-manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"PASS 2.6.2: {checks} model checks, eight focused browser checks, five widths, {browser['pdf']['pages']} reviewed PDF pages")
    print(source_hash)
    raise SystemExit(0)

if version == "2.6.1":
    demo = read("demoBrowser", "output/playwright/repeat-demo/review.json")
    assert demo["pass"] and not demo["errors"] and not demo["network"]
    assert len(demo["checks"]) == 6
    assert demo["baselineHash"] == digest(ROOT / "output/backups/repeat-visual-20261007/Ringside_Boxing_Assessment.html")
    layouts = [x for x in demo["layouts"] if x["version"] == "after"]
    assert {1920,1440,1280,900,390} == {x["width"] for x in layouts}
    for item in layouts:
        before = next(x for x in demo["layouts"] if x["version"] == "before" and x["width"] == item["width"])
        assert item["noOverflow"] and not item["labelsOutside"] and item["height"] < before["height"] * .92
    images(demo["images"])
    images(demo["downloads"])
    assert demo["pdf"]["sha256"] == digest(ROOT / demo["pdf"]["path"])
    pdf = read("demoPDF", "output/pdf/demo-download-verification.json")
    assert len(pdf["cases"]) == 1 and pdf["cases"][0]["pass"]
    case = pdf["cases"][0]
    assert case["pdfSha256"] == demo["pdf"]["sha256"]
    for field in ["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"]:
        assert not case["diagnostics"][field]
    render = read("demoPDFRender", "output/pdf/demo-render-verification.json")
    assert render["pass"] and render["cases"][0]["pages"] == demo["pdf"]["pages"]
    assert render["cases"][0]["pdfSha256"] == demo["pdf"]["sha256"]
    assert all(p["a4"] and p["bodyInkPixels"] > 0 for p in render["cases"][0]["pageChecks"])
    visual = read("demoVisual", "output/pdf/demo-visual-review.json")
    assert visual["pass"] and visual["manuallyReviewed"] and visual["pages"] == demo["pdf"]["pages"]
    images(visual["images"])
    result = {"pass":True,"implementationComplete":True,"approvedAcceptancePass":True,"version":version,
        "approvedRevision":"RS-20261007-REPEAT-DEMO-VISUAL","html":HTML.name,"sha256":source_hash,"bytes":HTML.stat().st_size,
        "reproducibleBuild":True,"modules":modules,"evidence":evidence,"modelChecks":checks,"focusedBrowserChecks":6,"layoutWidths":5,
        "pdfPagesReviewed":demo["pdf"]["pages"],"demoGroups":56,"simulatedDemoData":True,
        "scope":"Richer three-trial demo, smaller isometric chart, no repeated aggregation-mode hints in result tables/charts.",
        "verificationLimits":["Prior 2.6.0 full browser workflow acceptance is historical; this display-only revision uses focused browser checks.","Mobile layouts are browser emulation; no physical-device or live AI-provider claim."]}
    (ROOT / "output/acceptance-manifest.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"PASS 2.6.1: {checks} model checks, five widths, six focused browser checks, {demo['pdf']['pages']} PDF pages")
    print(source_hash)
    raise SystemExit(0)

repeat = read("repeatBrowser", "output/playwright/repeats/review.json")
assert repeat["pass"] and not repeat["errors"] and not repeat["network"]
assert len(repeat["checks"]) == 12
assert {1920,1440,1280,900,390} == {r["width"] for r in repeat["layouts"]}
assert all(r["noOverflow"] for r in repeat["layouts"])
images(repeat["images"])
images(repeat["downloads"])
for name, file, count in [("coreBrowser","core-verification-results.json",13),("workflowBrowser","workflow-verification-results.json",24)]:
    result = read(name, "output/playwright/" + file)
    assert result["passed"] == count and result["failed"] == 0 and not result.get("fatalError")
    assert len(result["tests"]) == count and all(t["pass"] for t in result["tests"])
    assert not result["browserErrors"]
    if name == "workflowBrowser":
        assert result["networkRequests"] == [{"id": "ai-background", "url": "https://ringside-tests.invalid/v1/chat/completions"}]
    else:
        assert not result["networkRequests"]
    evidence[name]["checks"] = count
ai = read("aiFactsAndFlow", "output/ai/narrative-flow.json")
assert ai["pass"] and ai["synthetic"] and not ai["liveQualityEvidence"] and not ai["errors"]
assert len(ai["checks"]) == 6 and "repeat-facts-match-shared-analysis" in ai["checks"]

download = read("repeatPDF", "output/pdf/repeat-download-verification.json")
assert download["pass"] and download["foldStateIndependent"]
expected = {"repeat-collapsed","repeat-expanded-mobile"}
assert {c["id"] for c in download["cases"]} == expected
for case in download["cases"]:
    assert case["pass"] and not case["errors"] and not case["network"]
    assert case["pdfSha256"] == digest(ROOT / "output/pdf" / (case["id"] + ".pdf"))
    assert case["diagnostics"]["status"] == "complete"
    for field in ["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"]:
        assert not case["diagnostics"][field]
    assert len({c["page"] for c in case["continued"]}) >= 2
assert download["cases"][0]["pages"] == download["cases"][1]["pages"]
render = read("repeatPDFRender", "output/pdf/repeat-render-verification.json")
assert render["pass"] and {c["id"] for c in render["cases"]} == expected
for case in render["cases"]:
    assert case["pdfSha256"] == digest(ROOT / "output/pdf" / (case["id"] + ".pdf"))
    assert all(p["a4"] and p["bodyInkPixels"] > 0 for p in case["pageChecks"])
pages = sum(c["pages"] for c in render["cases"])
visual = read("visualReview", "output/pdf/repeat-visual-review.json")
assert visual["pass"] and visual["pages"] == pages and visual["manuallyReviewed"]
assert visual["foldStateIdenticalPixels"]
images(visual["images"])
retry = read("pdfFailureRetry", "output/pdf/failure-ui-verification.json")
assert retry["pass"] and retry["failure"]["status"] == "failed" and retry["retryPages"] > 0

version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
assert version == "2.6.0"
result = {
    "pass": True, "implementationComplete": True, "approvedAcceptancePass": True,
    "version": version, "approvedRevision": "RS-20261007-REPEATS",
    "html": HTML.name, "sha256": source_hash, "bytes": HTML.stat().st_size,
    "reproducibleBuild": True, "modules": modules, "evidence": evidence,
    "modelChecks": checks, "browserWorkflowChecks": 49, "pdfPagesReviewed": pages,
    "scope": "Unified repeat entry, grouping, representation, statistics, persistence, offline report and PDF appendix.",
    "verificationLimits": ["AI facts and edit/apply flow use a simulated response; no new live-provider quality claim.", "Mobile layout uses browser emulation; physical mobile devices and printing were not tested."],
}
(ROOT / "output/acceptance-manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"PASS 2.6.0: {checks} model checks, 49 browser workflow checks, 6 AI flow checks, {pages} PDF pages, failure/retry")
print(source_hash)
