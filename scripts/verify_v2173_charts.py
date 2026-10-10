"""Verify 2.17.3 chart restoration using exact current-build evidence."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import struct
import subprocess
import sys

from verify_v217_local import (ROOT, VERSION, artifact, digest, inline_modules,
                               load, local_path, require, verify_exports,
                               verify_item, verify_science)

CHANNELS = ("chrome", "msedge")
WIDTHS = (1440, 390)
BASE = "output/playwright/fvp-three-regions"
HISTORY = {
    "original": "a97c903c243246df6a6cb569d28a17c7bc3d35f9380bd3885d973f00d931edff",
    "regression": "7bc7de631f464cee5c9dff2108375e8425ec34e355e943d030f5f38861c8c033",
}
MANIFEST = "output/acceptance-manifest-2.17.3-chart-restore.json"


def registered_checks(path):
    code = local_path(path).read_text(encoding="utf-8")
    names = re.findall(r'\bawait\s+check\(\s*"([^"\n]+)"', code)
    pdf = re.findall(r'if\s*\(\s*process\.argv\.includes\(\s*"--pdf"\s*\)\s*\)\s*\{?\s*await\s+check\(\s*"([^"\n]+)"', code)
    require(names and len(set(names)) == len(names) and len(pdf) == 1, "Cannot resolve current browser scenario registry: " + path)
    return names, pdf


def verify_units(sha, evidence):
    data = load("output/tests/unit-results.json")
    require(data.get("sourceHash") == sha, "Unit results refer to another HTML")
    code = local_path("tests/run-unit-tests.cjs").read_text(encoding="utf-8")
    match = re.search(r'for\s*\(\s*const\s+name\s+of\s*\[(.*?)\]\s*\)', code, re.S)
    require(match is not None, "Cannot read the current unit suite registry")
    names = re.findall(r'["\']([^"\'\n]+\.cjs)["\']', match.group(1))
    suites = data.get("suites", [])
    require(names and len(names) == len(set(names)), "Duplicate unit suite registration")
    require(len(suites) == len(names) and {suite["name"] for suite in suites} == set(names), "Unit run did not complete every registered suite")
    require(all(suite.get("exitCode") == 0 and type(suite.get("checksPassed")) is int and suite["checksPassed"] > 0 for suite in suites), "A registered unit suite failed or contains no checks")
    evidence["unitResults"] = artifact("output/tests/unit-results.json")
    evidence["unitRunner"] = artifact("tests/run-unit-tests.cjs")
    return {"suiteCount": len(suites), "checks": sum(suite["checksPassed"] for suite in suites), "suiteNames": names}


def verify_graph_pdf(data):
    from pypdf import PdfReader

    pdf = data.get("pdf")
    require(pdf is not None, "Desktop graph run has no actual PDF")
    candidates = [item for item in data["artifacts"] if item.get("kind") == "actual-pdf"]
    require(len(candidates) == 1, "Graph run must have exactly one actual PDF download")
    path = verify_item(candidates[0])
    if "path" in pdf:
        require(verify_item(pdf) == path, "PDF metadata refers to a different download")
    require(path.read_bytes().startswith(b"%PDF-"), "Graph PDF is not readable PDF bytes")
    diagnostic = pdf["diagnostics"]
    require(diagnostic["status"] == "complete", "Graph PDF export is incomplete")
    for key in ("missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"):
        require(diagnostic[key] == [], "Graph PDF diagnostic failed: " + key)
    require(diagnostic["textChecks"] and all(row.get("exact") is True for row in diagnostic["textChecks"]), "Graph PDF text differs from the report")
    pages = pdf["pages"]
    require(pages and len(PdfReader(path).pages) == len(pages), "Actual graph PDF page count differs from capture")
    require(all(page["overflow"] == [] for page in pages), "Graph PDF content overflows")
    charts = [chart for page in pages for chart in page["charts"]]
    counts = {kind: sum(chart["kind"] == kind for chart in charts) for kind in ("jumpFvp", "jumpElasticity", "sprintFvp")}
    require(counts == {"jumpFvp": 2, "jumpElasticity": 2, "sprintFvp": 1}, "PDF must contain SJ/CMJ FVP, SJ/CMJ elasticity and one sprint FVP")
    # PDF export freezes SVGs into raster images. An empty SVG list is expected
    # in that stage; page diagnostics and the actual rendered-page review remain
    # mandatory. Validate raster dimensions when the runner records them.
    for chart in charts:
        for image in chart.get("images", []):
            bounds = image.get("bounds", image)
            require(image["naturalWidth"] > 0 and image["naturalHeight"] > 0 and bounds["width"] > 0 and bounds["height"] > 0 and image.get("complete") is True, "PDF raster graph is unreadable or has empty dimensions")
    text = "\n".join(page["text"] for page in pages)
    require("SJ" in text and "CMJ" in text, "Graph PDF lacks both jump protocol labels")
    return {**artifact(path), "pageCount": len(pages), "chartCounts": counts}


def verify_regions(sha, fixture_sha, evidence):
    names, pdf_names = registered_checks("tests/fvp-three-region-browser-tests.cjs")
    runner_sha = digest(local_path("tests/fvp-three-region-browser-tests.cjs"))
    cases, lookup = [], {}
    for channel in CHANNELS:
        for width in WIDTHS:
            relative = f"{BASE}/fixed/{channel}-{width}-results.json"
            data = load(relative)
            require(data.get("sourceSha256") == sha and data.get("sourceUnchanged") is True, "Stale graph evidence: " + relative)
            require(data.get("pass") is True and data.get("synthetic") is True and data.get("label") == "fixed", "Final graph suite did not pass: " + relative)
            require(data["channel"] == channel and data["width"] == width and data["runnerSha256"] == runner_sha and data["fixtureSha256"] == fixture_sha, "Graph run identity, runner or common fixture differs")
            require(data["errors"] == data["network"] == data["failures"] == [], "Final graph run has errors, external requests or failed checks")
            expected = names if width == 1440 else [name for name in names if name not in pdf_names]
            require(len(data["checks"]) == len(expected) and set(data["checks"]) == set(expected), "Final graph suite omits a current registered scenario")
            for item in data["artifacts"]:
                verify_item(item)
            reference = data.get("calculationReference")
            require(reference is not None and reference["sourceSha256"] == HISTORY["original"], "Final graph run lacks the original model comparison")
            reference_path = verify_item(reference); original = load(reference_path)
            require(original["sourceSha256"] == HISTORY["original"] and original["fixtureSha256"] == fixture_sha, "Original model comparison used another source or fixture")
            initial = next((state for state in data["states"] if state["name"] == "historical-initial"), None)
            prior = next((state for state in original["states"] if state["name"] == "historical-initial"), None)
            require(initial is not None and prior is not None and initial["solved"] == prior["solved"], "Restored jump FVP/elastic model or scenario values differ from the original")
            evidence["originalCalculationReference"] = artifact(reference_path)
            folded = next((state for state in data["states"] if state["name"] == "independent-graphs-folded-capability"), None)
            require(folded is not None and folded["detail"]["open"] is False and folded["documentOverflow"] is False, "Missing real folded-capability observation")
            require({region["kind"] for region in folded["regions"]} == {"jumpFvp", "jumpElasticity", "sprintFvp"}, "Folded capability hides a graph region")
            for region in folded["regions"]:
                require(region["bounds"]["effectiveVisible"] is True and "trainingAnalysisDetail" not in region["bounds"]["closedAncestors"] and region["svgs"], "A graph remains inside folded capability details")
                require(all(svg["bounds"]["effectiveVisible"] and svg["bounds"]["width"] > 100 and svg["bounds"]["height"] > 100 for svg in region["svgs"]), "Folded-state SVG is not visible")
            evidence[f"{channel}Graph{width}"] = artifact(relative)
            case = {"channel": channel, "width": width, "checks": len(data["checks"]), "sourceSha256": sha, "result": artifact(relative), "pdf": verify_graph_pdf(data) if width == 1440 else None}
            cases.append(case); lookup[("fixed", channel, width)] = [data]
    return cases, lookup


def verify_history(fixture_sha, evidence, lookup):
    historical = []
    for label, expected_sha in HISTORY.items():
        primary = local_path(f"{BASE}/baseline-{label}-v3/chrome-1440-results.json")
        paths = sorted(primary.parent.glob("*-results.json"))
        narrow = ROOT / BASE / f"baseline-{label}-390"
        require(list(narrow.glob("*-390-results.json")), "Missing narrow historical comparison: " + label)
        paths += sorted(narrow.glob("*-results.json"))
        # Earlier screenshots may be selected for visual comparison. Their
        # runner hash remains a historical fact rather than a current-pass gate.
        paths += sorted((ROOT / BASE / label).glob("*-results.json"))
        runs = []
        for path in paths:
            data = load(path)
            require(data["sourceSha256"] == expected_sha and data["fixtureSha256"] == fixture_sha and data["sourceUnchanged"] is True and data["synthetic"] is True, "Historical source or shared fixture differs: " + str(path))
            require(data["label"] == label and re.fullmatch(r"[a-f0-9]{64}", data["runnerSha256"]), "Historical runner identity is missing")
            source = (ROOT / data["source"]).resolve()
            require(source.is_relative_to(ROOT.parent) and source.is_file() and digest(source) == expected_sha, "Historical HTML no longer matches its recorded source hash")
            for item in data["artifacts"]:
                verify_item(item)
            lookup.setdefault((label, data["channel"], data["width"]), []).append(data)
            runs.append({"result": artifact(path), "sourceSha256": expected_sha, "runnerSha256": data["runnerSha256"], "fixtureSha256": fixture_sha, "reportedPass": data["pass"], "passedChecks": len(data["checks"]), "failures": data["failures"], "includedInCurrentAcceptance": False})
        require(runs, "Missing historical comparison: " + label)
        historical.append({"label": label, "sourceSha256": expected_sha, "includedInCurrentAcceptance": False, "runs": runs})
    return historical


def verify_visual(sha, cases, lookup, evidence):
    from pypdf import PdfReader

    relative = BASE + "/visual-review.json"; data = load(relative)
    require(data.get("sourceSha256") == sha and data.get("synthetic") is True and data.get("pass") is True and data.get("issues") == [], "Visual review refers to another candidate or is unresolved")
    require(data.get("allPagesVisuallyReviewed") is True and data.get("actualImagesViewed") is True, "Actual PDF pages have not all been visually reviewed")
    pdfs = data.get("pdfs", [])
    require(len(pdfs) == 2 and {case["channel"] for case in pdfs} == set(CHANNELS), "Both actual desktop graph PDFs need review")
    current = {case["channel"]: case["pdf"] for case in cases if case["pdf"]}
    count = 0
    for case in pdfs:
        pdf_path = verify_item(case); expected = current[case["channel"]]
        require(case.get("width", 1440) == 1440 and artifact(pdf_path)["sha256"] == expected["sha256"] and artifact(pdf_path)["path"] == expected["path"], "Visual review used another graph PDF")
        pages = len(PdfReader(pdf_path).pages)
        require(pages == case["pageCount"] == expected["pageCount"] and case["reviewedPages"] == list(range(1, pages + 1)) and case["allTextChecksExact"] is True, "Graph PDF review page coverage differs")
        render_path = verify_item({"path": case["renderResultsPath"], "sha256": case["renderResultsSha256"]})
        render = load(render_path)
        require(local_path(render["pdf"]) == pdf_path and render["pdfSha256"] == digest(pdf_path), "Page PNG evidence used another PDF")
        require([page["page"] for page in render["pages"]] == list(range(1, pages + 1)), "Rendered page set is incomplete")
        for page in render["pages"]:
            png = verify_item({"path": page["png"], "sha256": page["sha256"]})
            require(list(struct.unpack(">II", png.read_bytes()[16:24])) == page["size"] and page["inkBounds"] is not None, "Unreadable or blank PDF page PNG")
            width, height = page["pdfPointSize"]
            require(abs(width - 595.28) < 2 and abs(height - 841.89) < 2, "Graph PDF page is not A4")
        evidence[case["channel"] + "GraphPdfRender"] = artifact(render_path); count += pages
    require(data.get("actualImageCount") == count, "Actual reviewed PNG count differs from current PDF pages")
    screenshots = data.get("screenshots", [])
    for label in ("original", "regression", "fixed"):
        require(set(WIDTHS) <= {item["width"] for item in screenshots if item["label"] == label}, "Three-version comparison lacks desktop/narrow screenshots: " + label)
    for channel in CHANNELS:
        require(set(WIDTHS) <= {item["width"] for item in screenshots if item["label"] == "fixed" and item["channel"] == channel}, "Current browser visual review lacks both widths: " + channel)
    for item in screenshots:
        verify_item(item)
        records = lookup.get((item["label"], item["channel"], item["width"]), [])
        require(any(any(artifact["path"] == item["path"] and artifact["sha256"] == item["sha256"] for artifact in record["artifacts"]) for record in records), "Screenshot is not bound to its version/viewport run")
    evidence["visualReview"] = artifact(relative)
    return {"pdfFiles": 2, "actualPdfPagesReviewed": count, "screenshots": len(screenshots), "historicalScreenshotsAreCurrentPass": False, "limitations": data.get("limitations", [])}


def verify_sprint(sha, evidence):
    names, pdf_names = registered_checks("tests/sprint-fvp-browser-tests.cjs")
    expected = [name for name in names if name not in pdf_names]
    runs = []
    for channel in CHANNELS:
        relative = f"output/playwright/sprint-fvp-2.17.3-local/{channel}-results.json"; data = load(relative)
        require(data.get("sourceHash") == sha and data.get("sourceUnchanged") is True and data.get("pass") is True and data.get("synthetic") is True and data.get("channel") == channel, "Sprint full workflow is stale or incomplete")
        require(data["errors"] == data["network"] == [] and len(data["checks"]) == len(expected) and set(data["checks"]) == set(expected), "Sprint full workflow omits a current scenario")
        require({row["width"] for row in data["layouts"]} == {1440, 900, 390} and all(not row["pageOverflow"] for row in data["layouts"]), "Sprint capability layout overflows or lacks widths")
        exports = verify_exports(data, channel)
        evidence[channel + "SprintWorkflow"] = artifact(relative)
        runs.append({"channel": channel, "checks": len(data["checks"]), "exports": exports, "pdfScope": "Actual PDF coverage comes from the three-region graph suite"})
    evidence["sprintRunner"] = artifact("tests/sprint-fvp-browser-tests.cjs")
    return runs


def main():
    require(VERSION == "2.17.3-local", "This verifier is only for the chart-restoration delivery")
    html_path = local_path("MotionBench.html"); sha = digest(html_path)
    require(digest(local_path("Ringside_Boxing_Assessment.html")) == sha, "Standalone HTML files differ")
    subprocess.run([sys.executable, "scripts/build.py"], cwd=ROOT, check=True)
    require(digest(html_path) == digest(local_path("Ringside_Boxing_Assessment.html")) == sha, "Rebuild changed the tested HTML; rerun current-candidate evidence")
    html = html_path.read_text(encoding="utf-8"); modules = inline_modules(html)
    require('window.RingsideBuild=Object.freeze(' + json.dumps({"version": VERSION}) + ');' in html, "Embedded build version differs")
    require(re.search(r'<script id="embedded-data" type="application/json">\s*null\s*</script>', html), "Delivery contains embedded record data")
    evidence = {}; units = verify_units(sha, evidence)
    fixture = artifact("tests/fixtures/three-fvp-regions.json")
    require(load(fixture["path"]).get("synthetic") is True, "Chart fixture is not synthetic")
    evidence["graphRunner"] = artifact("tests/fvp-three-region-browser-tests.cjs"); evidence["commonGraphFixture"] = fixture
    cases, lookup = verify_regions(sha, fixture["sha256"], evidence)
    historical = verify_history(fixture["sha256"], evidence, lookup)
    visual = verify_visual(sha, cases, lookup, evidence)
    sprint = verify_sprint(sha, evidence); science = verify_science(modules, evidence)
    result = {"pass": True, "version": VERSION, "deliveryScope": "Local chart restoration; no release, merge or deployment",
              "completedAtUTC": datetime.now(timezone.utc).isoformat(), "sha256": sha, "bytes": html_path.stat().st_size,
              "standaloneFilesEqual": True, "reproducibleBuild": True, "embeddedData": None,
              "modules": modules, "unitVerification": units, "graphBrowserVerification": cases,
              "sprintWorkflowVerification": sprint, "visualVerification": visual,
              "scientificModuleVerification": science, "historicalComparisons": historical, "evidence": evidence,
              "verificationLimits": ["All records and browser storage are synthetic; browsers run offline in isolated contexts.",
                  "Historical original/regression runs are comparison evidence and never count as current acceptance.",
                  "This round restores graph visibility; it makes no claim that the four known storage concurrency defects were fixed.",
                  "The user's workbook was not materialized on Windows and is not treated as verified formula/chart evidence.",
                  "Independent scientific verification binds calculation modules, not final HTML execution.",
                  "Physical devices, paper printing, native Excel and a packaged Windows application were not tested.", *visual["limitations"]]}
    (ROOT / MANIFEST).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    public = {key: result[key] for key in ("pass", "version", "deliveryScope", "completedAtUTC", "sha256", "bytes", "standaloneFilesEqual", "reproducibleBuild", "embeddedData", "unitVerification", "visualVerification", "scientificModuleVerification", "verificationLimits")}
    public["graphBrowserRuns"] = [{key: case[key] for key in ("channel", "width", "checks", "pdf")} for case in cases]
    public["sprintWorkflowChecks"] = [{"channel": run["channel"], "checks": run["checks"]} for run in sprint]
    public["historicalComparisons"] = [{"label": label, "sourceSha256": value, "includedInCurrentAcceptance": False} for label, value in HISTORY.items()]
    public["evidenceIndex"] = MANIFEST
    (ROOT / "docs/acceptance-2.17.3-local.json").write_text(json.dumps(public, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"PASS {VERSION}: {units['suiteCount']} unit suites, {sum(case['checks'] for case in cases)} graph scenarios, {sum(run['checks'] for run in sprint)} sprint scenarios, {visual['actualPdfPagesReviewed']} actual PDF pages reviewed")
    print(sha)


if __name__ == "__main__":
    main()
