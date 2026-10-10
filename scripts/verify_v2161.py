"""Verify 2.16.1 source, offline workflows, retained Excel files and PDF review."""
from pathlib import Path
import base64
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(relative):
    return json.loads((ROOT / relative).read_text(encoding="utf-8-sig"))


def artifact(relative):
    return {"path": str(relative).replace("\\", "/"), "sha256": digest(ROOT / relative)}


def verify_item(item):
    path = Path(item["path"])
    path = path if path.is_absolute() else ROOT / path
    assert path.resolve().is_relative_to(ROOT) and path.is_file(), str(path)
    assert digest(path) == item["sha256"], str(path)


def main():
    sha = digest(ROOT / "MotionBench.html")
    assert load("package.json")["version"] == "2.16.1"
    assert digest(ROOT / "Ringside_Boxing_Assessment.html") == sha
    subprocess.run([sys.executable, "scripts/build.py"], cwd=ROOT, check=True)
    assert digest(ROOT / "MotionBench.html") == sha, "Build changed the tested artifact"
    html = (ROOT / "MotionBench.html").read_text(encoding="utf-8")
    body = (ROOT / "body-map-front.png").read_bytes()
    assert "window.RingsideBodyImage=" + json.dumps("data:image/png;base64," + base64.b64encode(body).decode("ascii")) + ";" in html
    modules = {}
    for path in (ROOT / "src").glob("*.js"):
        source = path.read_text(encoding="utf-8").replace("</script", "<\\/script")
        assert "<script>\n" + source + "\n</script>" in html, path.name
        modules[path.name] = digest(path)
    evidence = {}

    def read(name, relative, count=None):
        data = load(relative)
        assert data["sourceHash"] == sha, "Stale evidence: " + relative
        evidence[name] = artifact(relative)
        if count is not None:
            assert data["pass"] and len(data["checks"]) == count, relative
            assert not data["errors"] and not data["network"], relative
        return data

    unit = read("unit", "output/tests/unit-results.json")
    assert len(unit["suites"]) == 34
    assert all(s["exitCode"] == 0 and s["checksPassed"] > 0 for s in unit["suites"])
    model_checks = sum(s["checksPassed"] for s in unit["suites"])
    browser_checks, layouts = 0, []
    for channel in ["chrome", "msedge"]:
        migration = read(channel + "Migration", f"output/playwright/v2161-migration/{channel}-results.json", 7)
        for item in migration["artifacts"]:
            verify_item(item)
        browser_checks += len(migration["checks"])
        dsi = read(channel + "DSI", f"output/v2161-dsi/{channel}-results.json", 10)
        browser_checks += len(dsi["checks"])
        evaluation = read(channel + "Evaluation", f"output/playwright/v2161-evaluation/{channel}-results.json", 6)
        for item in evaluation.get("artifacts", []):
            verify_item(item)
        browser_checks += len(evaluation["checks"])
        report = read(channel + "Report", f"output/playwright/report-v2161/{channel}-results.json", 12)
        assert report["sourceUnchanged"]
        assert {item["width"] for item in report["layouts"]} == {1440, 1280, 900, 390}
        assert all(not item["overflow"] for item in report["layouts"])
        for item in report["images"] + report["pdfs"]:
            verify_item(item)
        for case in report["pdfs"]:
            diagnostic = case["diagnostics"]
            assert diagnostic["status"] == "complete"
            for key in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
                assert not diagnostic[key], key
            assert all(not page["overflow"] and not page["cellOverflow"] for page in case["pages"])
            assert sum(page["cellCount"] for page in case["pages"]) > 0
        if report.get("html"):
            verify_item(report["html"])
        browser_checks += len(report["checks"])
        layouts.extend(report["layouts"])
        independent = read(channel + "IndependentHTML", f"output/playwright/report-v2161/{channel}-html-results.json", 2)
        assert independent["sourceUnchanged"]
        verify_item(independent["html"])
        for item in independent["artifacts"]:
            verify_item(item)
        browser_checks += len(independent["checks"])
    render = read("renderedPDF", "output/playwright/report-v2161/pdf-render-results.json")
    assert render["pass"] and render["a4"] and render["nonempty"] and render["cellBounds"]["pass"]
    assert render["visualReview"]["pass"] and len(render["visualReview"]["reviewedPages"]) == render["pageCount"]
    for item in render["artifacts"]:
        verify_item(item)

    # These unchanged native Excel workbooks are retained evidence, not newly
    # executed native Excel scenarios. Current product imports are checked below.
    baseline = load("docs/acceptance-2.16.0.json")
    assert baseline["pass"] and baseline["sha256"] == "2638d9669e153c2e2d3c55a8f879003da06ac962cb8b765b44d3bf26e3606690"
    for module in ["ringside-excel.js", "ringside-calc.js"]:
        assert modules[module] == baseline["modules"][module], "Retained Excel evidence requires an unchanged module"
    native = baseline["nativeExcel"]
    assert native["pass"] and native["actualMicrosoftExcel"]
    for case in native["native"]["checks"]:
        verify_item({"path": case["workbook"], "sha256": case["workbookSha256"]})
    old_workbook = baseline["genuine215Excel"]
    verify_item({"path": old_workbook["workbook"], "sha256": old_workbook["workbookSha256"]})
    evidence["retained2160Acceptance"] = artifact("docs/acceptance-2.16.0.json")
    # Current Excel workflow evidence is added after the replay runner completes.
    browser_checks += verify_excel_replay(sha, evidence)
    remote = subprocess.run(["git", "ls-remote", "origin", "refs/tags/rollback-v2.16.0-20261010", "refs/tags/rollback-v2.16.0-20261010^{}"], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    assert "190ea641873c839d52679b6201b73c1c231a0479\trefs/tags/rollback-v2.16.0-20261010^{}" in remote
    rollback_zip = ROOT / "output/rollback/motionbench-2.16.0-20261010/source.zip"
    assert digest(rollback_zip) == "139e25c362b6b9ffbb5b696cf1fc9b2e94a8d006a61fd8dedcaa6102d4e48e0b"
    result = {"pass": True, "implementationComplete": True, "approvedAcceptancePass": True,
        "version": "2.16.1", "approvedRevision": "MotionBench 2.16.1 report and evaluation follow-up",
        "approvedAmendment": "IMTP shares short assessment labels; clarify target/range precedence and fix disabled extension grading.",
        "html": "MotionBench.html", "sha256": sha, "bytes": (ROOT / "MotionBench.html").stat().st_size,
        "reproducibleBuild": True, "modules": modules, "assets": {"body-map-front.png": digest(ROOT / "body-map-front.png")},
        "evidence": evidence, "unitSuites": len(unit["suites"]), "modelChecks": model_checks,
        "browserWorkflowChecks": browser_checks, "layouts": layouts, "pdfPagesVisuallyReviewed": render["pageCount"],
        "retainedNativeExcelWorkbooks": 10, "newNativeExcelOperations": 0,
        "rollback": {"tag": "rollback-v2.16.0-20261010", "commit": "190ea641873c839d52679b6201b73c1c231a0479", "remoteVerified": True,
            "htmlSHA256": baseline["sha256"], "sourceArchiveSHA256": digest(rollback_zip)},
        "verificationLimits": ["Synthetic records in isolated installed Chrome/Edge contexts; narrow screens are emulated.",
            "Replayed existing native Excel files through this release; no new native Excel operation was performed because the Excel and calculation modules are unchanged.",
            "ER:IR population means alone do not define individual assessment intervals; no new ratio cutoff was invented.",
            "Literature reference comparability with the user's fixed dynamometry protocol remains unverified.",
            "No physical mobile, physical printing, new live AI content-quality, or clean Windows-machine installation test was run."]}
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    (ROOT / "output/acceptance-manifest.json").write_text(text, encoding="utf-8")
    (ROOT / "docs/acceptance-2.16.1.json").write_text(text, encoding="utf-8")
    print(f"PASS 2.16.1: {model_checks} model checks, {browser_checks} browser checks, {render['pageCount']} reviewed PDF pages")
    print(sha)


def verify_excel_replay(sha, evidence):
    checks = 0
    def read(name, relative):
        data = load(relative)
        assert data["pass"] and data["sourceHash"] == sha, relative
        evidence[name] = artifact(relative)
        return data
    preflight = read("ExcelReusePreflight", "output/tests/v2161-excel/v216-excel-reuse-preflight.json")
    assert preflight["reusedNativeWorkbooks"] == 10 and preflight["allOriginalInputsUnchanged"] and preflight["allSavedNativeWorkbookHashesMatch"]
    assert preflight["excelModuleSha256"] == digest(ROOT / "src/ringside-excel.js")
    native = read("nativeExcelReplay", "output/tests/v2161-excel/v216-excel-native-workflow-results.json")
    assert native["actualMicrosoftExcel"] and native["uniqueNativeWorkbookScenarios"] == 9 and native["productBrowserScenarios"] == 18
    assert native["excelModuleSha256"] == digest(ROOT / "src/ringside-excel.js")
    assert native["native"]["native"]["savedAll"]
    for case in native["native"]["checks"]:
        assert case["pass"]
        verify_item({"path": case["workbook"], "sha256": case["workbookSha256"]})
    assert {browser["channel"] for browser in native["product"]} == {"chrome", "msedge"}
    for browser in native["product"]:
        assert browser["pass"] and browser["sourceHash"] == sha and not browser["errors"] and not browser["network"]
        assert len(browser["checks"]) == 9 and all(case["pass"] for case in browser["checks"])
        checks += len(browser["checks"])
    old = read("genuine215ExcelReplay", "output/tests/v2161-excel/v216-excel-genuine-v215.json")
    assert old["actualMicrosoftExcel"] and old["producerVersion"] == "2.15.0" and old["currentAppHash"] == sha
    assert old["producerTag"] == "rollback-v2.15.0-20261009" and old["producerCommit"] == "206bf47cc558e1ca4c9c7aa86c561c2e711ab41d"
    assert old["producerHtmlSha256"] == "5415e9352d43be9f071ae8519a1f12ccd8e80e55b40f1e891d5c74e3b1fccff6"
    assert old["productBrowserScenarios"] == 2 and not old["currentParserErrors"]
    assert any(case["address"] == "C6" for case in old["reproducedOldParserIdentityError"])
    verify_item({"path": old["workbook"], "sha256": old["workbookSha256"]})
    for relative, expected in old["moduleHashes"]["producer"].items():
        old_bytes = subprocess.run(["git", "show", old["producerTag"] + ":" + relative], cwd=ROOT, check=True, capture_output=True).stdout
        assert hashlib.sha256(old_bytes).hexdigest() == expected, relative
    assert all(digest(ROOT / relative) == expected for relative, expected in old["moduleHashes"]["current"].items())
    assert digest(ROOT / "vendor/exceljs.min.js") == old["vendorSha256"]
    assert {browser["channel"] for browser in old["browserCases"]} == {"chrome", "msedge"}
    for browser in old["browserCases"]:
        assert browser["pass"] and browser["sourceHash"] == sha and not browser["errors"] and not browser["network"]
        assert len(browser["checks"]) == 1
        case = browser["checks"][0]
        assert case["pass"] and case["workbookSha256"] == old["workbookSha256"]
        assert case["actualUIUploadAndConfirmation"] and case["refreshPersistence"] and case["savedRecordCount"] == 1
        checks += 1
    for channel in ["chrome", "msedge"]:
        flow = read(channel + "ExcelWorkflow", f"output/playwright/v2161-excel/{channel}-results.json")
        assert len(flow["checks"]) == 15 and not flow["errors"] and not flow["network"]
        assert all(not item["overflow"] for item in flow["layouts"])
        for item in flow.get("images", []):
            verify_item(item)
        checks += len(flow["checks"])
    return checks


if __name__ == "__main__":
    main()
