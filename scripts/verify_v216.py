"""Bind 2.16 acceptance to the exact offline source and actual file workflows."""
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
    assert load("package.json")["version"] == "2.16.0"
    assert digest(ROOT / "Ringside_Boxing_Assessment.html") == sha
    subprocess.run([sys.executable, "scripts/build.py"], cwd=ROOT, check=True)
    assert digest(ROOT / "MotionBench.html") == sha, "Build changed the tested artifact"
    html = (ROOT / "MotionBench.html").read_text(encoding="utf-8")
    body_bytes = (ROOT / "body-map-front.png").read_bytes()
    assert "window.RingsideBodyImage=" + json.dumps("data:image/png;base64," + base64.b64encode(body_bytes).decode("ascii")) + ";" in html
    modules = {}
    for path in (ROOT / "src").glob("*.js"):
        source = path.read_text(encoding="utf-8").replace("</script", "<\\/script")
        assert "<script>\n" + source + "\n</script>" in html, path.name
        modules[path.name] = digest(path)
    evidence = {}
    def read(name, relative):
        data = load(relative)
        assert data["sourceHash"] == sha, "Stale evidence: " + relative
        evidence[name] = artifact(relative)
        return data
    unit = read("unit", "output/tests/unit-results.json")
    assert len(unit["suites"]) == 32
    assert all(s["exitCode"] == 0 and s["checksPassed"] > 0 for s in unit["suites"])
    checks = sum(s["checksPassed"] for s in unit["suites"])
    browser_checks = 0
    pdfs = []
    layouts = []
    for channel in ["chrome", "msedge"]:
        migration = read(channel + "Migration", f"output/playwright/v216-migration/{channel}-results.json")
        assert migration["pass"] and len(migration["checks"]) == 7 and not migration["errors"] and not migration["network"]
        for item in migration["artifacts"]:
            verify_item(item)
        browser_checks += len(migration["checks"])
        report = read(channel + "Report", f"output/playwright/report-v216/{channel}-results.json")
        assert report["pass"] and report["sourceUnchanged"] and len(report["checks"]) >= 9 and not report["errors"] and not report["network"]
        assert {item["width"] for item in report["layouts"]} == {1440, 1280, 900, 390}
        assert all(not item["overflow"] for item in report["layouts"])
        for item in report["images"] + report["pdfs"]:
            verify_item(item)
        for case in report["pdfs"]:
            diagnostics = case["diagnostics"]
            assert diagnostics["status"] == "complete"
            for key in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
                assert not diagnostics[key], key
            assert all(not page["overflow"] and not page["cellOverflow"] for page in case["pages"])
            assert sum(page["cellCount"] for page in case["pages"]) > 0
        if report.get("html"):
            verify_item(report["html"])
        pdfs.extend(report["pdfs"])
        layouts.extend(report["layouts"])
        browser_checks += len(report["checks"])
        independent = read(channel + "IndependentHTML", f"output/playwright/report-v216/{channel}-html-results.json")
        assert independent["pass"] and independent["sourceUnchanged"] and len(independent["checks"]) == 2 and not independent["errors"] and not independent["network"]
        verify_item(independent["html"])
        for item in independent["artifacts"]:
            verify_item(item)
        browser_checks += len(independent["checks"])
        workbook_flow = read(channel + "ExcelWorkflow", f"output/playwright/v213-excel/{channel}-results.json")
        assert workbook_flow["pass"] and len(workbook_flow["checks"]) == 15 and not workbook_flow["errors"] and not workbook_flow["network"]
        assert all(not item["overflow"] for item in workbook_flow["layouts"])
        for item in workbook_flow.get("images", []):
            verify_item(item)
        browser_checks += len(workbook_flow["checks"])
    # Actual Excel and rendered PDF evidence are inspected separately; they must
    # refer to this same HTML, even when native Excel files were created earlier.
    excel = read("nativeExcel", "output/tests/v216-excel-native-workflow-results.json")
    assert excel["pass"] and excel["actualMicrosoftExcel"]
    assert excel["uniqueNativeWorkbookScenarios"] == 9 and excel["productBrowserScenarios"] == 18
    assert excel["excelModuleSha256"] == digest(ROOT / "src/ringside-excel.js")
    assert excel["native"]["native"]["savedAll"] and all(case["pass"] for case in excel["native"]["checks"])
    for case in excel["native"]["checks"]:
        verify_item({"path": case["workbook"], "sha256": case["workbookSha256"]})
    for browser in excel["product"]:
        assert browser["pass"] and browser["sourceHash"] == sha and not browser["errors"] and not browser["network"]
        assert len(browser["checks"]) == 9 and all(case["pass"] for case in browser["checks"])
        browser_checks += len(browser["checks"])
    legacy = read("genuine215Excel", "output/tests/v216-excel-genuine-v215.json")
    assert legacy["pass"] and legacy["actualMicrosoftExcel"] and legacy["currentAppHash"] == sha
    assert legacy["producerVersion"] == "2.15.0" and legacy["producerTag"] == "rollback-v2.15.0-20261009"
    assert legacy["producerCommit"] == "206bf47cc558e1ca4c9c7aa86c561c2e711ab41d"
    assert legacy["producerHtmlSha256"] == "5415e9352d43be9f071ae8519a1f12ccd8e80e55b40f1e891d5c74e3b1fccff6"
    assert legacy["native"]["savedAll"] and len(legacy["native"]["cases"]) == 1
    verify_item({"path": legacy["workbook"], "sha256": legacy["workbookSha256"]})
    assert any(item["address"] == "C6" and "编号" in item["message"] for item in legacy["reproducedOldParserIdentityError"])
    assert not legacy["currentParserErrors"] and legacy["productBrowserScenarios"] == 2
    for relative, expected in legacy["moduleHashes"]["producer"].items():
        old_bytes = subprocess.run(["git", "show", legacy["producerTag"] + ":" + relative], cwd=ROOT, check=True, capture_output=True).stdout
        assert hashlib.sha256(old_bytes).hexdigest() == expected, relative
    assert all(digest(ROOT / relative) == expected for relative, expected in legacy["moduleHashes"]["current"].items())
    assert digest(ROOT / "vendor/exceljs.min.js") == legacy["vendorSha256"]
    assert {browser["channel"] for browser in legacy["browserCases"]} == {"chrome", "msedge"}
    for browser in legacy["browserCases"]:
        assert browser["pass"] and browser["sourceHash"] == sha and not browser["errors"] and not browser["network"]
        assert len(browser["checks"]) == 1 and browser["excelModuleSha256"] == digest(ROOT / "src/ringside-excel.js")
        case = browser["checks"][0]
        assert case["pass"] and case["workbookSha256"] == legacy["workbookSha256"]
        assert case["actualUIUploadAndConfirmation"] and case["refreshPersistence"] and case["savedRecordCount"] == 1
        browser_checks += 1
    render = read("renderedPDF", "output/playwright/report-v216/pdf-render-results.json")
    assert render["pass"] and render["a4"] and render["nonempty"]
    reviewed = render["visualReview"]["reviewedPages"]
    reviewed_count = len(reviewed) if isinstance(reviewed, list) else reviewed
    assert render["visualReview"]["pass"] and reviewed_count == render["pageCount"]
    for item in render["artifacts"]:
        verify_item(item)
    remote = subprocess.run(["git", "ls-remote", "origin", "refs/tags/rollback-v2.15.0-20261009", "refs/tags/rollback-v2.15.0-20261009^{}"], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    assert "206bf47cc558e1ca4c9c7aa86c561c2e711ab41d\trefs/tags/rollback-v2.15.0-20261009^{}" in remote
    result = {"pass": True, "implementationComplete": True, "approvedAcceptancePass": True,
        "version": "2.16.0", "approvedRevision": "MotionBench 2.16 调整计划", "html": "MotionBench.html",
        "approvedAmendment": "等长力量评价使用简短色标；单一力量目标仅黄色关注/绿色达标，疼痛和双侧差异沿用分级；人体图只显示有实际测试记录的部位圆圈。",
        "sha256": sha, "bytes": (ROOT / "MotionBench.html").stat().st_size, "reproducibleBuild": True,
        "modules": modules, "assets": {"body-map-front.png": digest(ROOT / "body-map-front.png")},
        "evidence": evidence, "unitSuites": len(unit["suites"]), "modelChecks": checks,
        "browserWorkflowChecks": browser_checks, "nativeExcel": excel, "genuine215Excel": legacy,
        "nativeWorkbookScenarios": 10, "layouts": layouts, "pdfPagesVisuallyReviewed": render["pageCount"],
        "rollback": {"tag": "rollback-v2.15.0-20261009", "commit": "206bf47cc558e1ca4c9c7aa86c561c2e711ab41d", "remoteVerified": True,
          "htmlSHA256": "5415e9352d43be9f071ae8519a1f12ccd8e80e55b40f1e891d5c74e3b1fccff6"},
        "verificationLimits": ["Excel operation methods and automatic expansion observations are recorded in the native Excel evidence; hidden COM cell writes do not substitute for keyboard input.",
          "Browser checks use synthetic records in isolated installed Chrome/Edge contexts; narrow layouts are emulated.",
          "No same-device study verifies comparability of the accepted published population means with the user's fixed dynamometry protocol.",
          "Bohannon Table 7 male wrist-extension first age row is interpreted as 20–29 from its sample size and adjoining row; original numerical observations are retained.",
          "No physical mobile, physical printing, new live AI content-quality, or clean Windows-machine installation check was run."]}
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    (ROOT / "output/acceptance-manifest.json").write_text(text, encoding="utf-8")
    (ROOT / "docs/acceptance-2.16.0.json").write_text(text, encoding="utf-8")
    print(f"PASS 2.16.0: {checks} model checks, {browser_checks} browser checks, actual Excel, {render['pageCount']} reviewed PDF pages")
    print(sha)

if __name__ == "__main__":
    main()
