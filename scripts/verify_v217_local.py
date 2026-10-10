"""Verify exact 2.17 local artifacts; never reuse an older candidate's pass."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import zipfile

ROOT = Path(__file__).absolute().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
ACCEPTANCE = {
    "2.17.0-local": {"browserDir": "output/playwright/sprint-fvp", "browserChecks": 12, "unitSuites": 37},
    "2.17.1-local": {"browserDir": "output/playwright/sprint-fvp-2.17.1-local", "browserChecks": 15, "unitSuites": 38},
}
CHANNELS = ("chrome", "msedge")
DIRECTIONS = ["strength", "reactive", "speed", "endurance"]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def local_path(value):
    path = Path(value)
    path = Path(os.path.abspath(path if path.is_absolute() else ROOT / path))
    require(path.is_relative_to(ROOT), "Evidence is outside the workspace: " + str(value))
    require(path.is_file(), "Missing evidence: " + str(value))
    return path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(value):
    return json.loads(local_path(value).read_text(encoding="utf-8-sig"))


def artifact(value):
    path = local_path(value)
    return {"path": path.relative_to(ROOT).as_posix(), "sha256": digest(path),
            "bytes": path.stat().st_size}


def verify_item(item):
    path = local_path(item["path"])
    require(item["sha256"] == digest(path), "Artifact hash changed: " + str(item["path"]))
    if path.suffix.lower() == ".png":
        header = path.read_bytes()[:24]
        require(header[:8] == b"\x89PNG\r\n\x1a\n", "Unreadable PNG: " + str(path))
        require(all(struct.unpack(">II", header[16:24])), "Empty PNG: " + str(path))
    return path


def read_current(relative, sha, evidence, name):
    data = load(relative)
    require(data.get("sourceHash") == sha, "Stale candidate evidence: " + relative)
    evidence[name] = artifact(relative)
    return data


def inline_modules(html):
    modules = {}
    for path in sorted((ROOT / "src").glob("*.js")):
        code = path.read_text(encoding="utf-8").replace("</script", "<\\/script")
        require("<script>\n" + code + "\n</script>" in html, "Module is not inlined: " + path.name)
        modules[path.name] = digest(path)
    require(modules, "No JavaScript modules found")
    return modules


def subset(record):
    return {"raw": record["data"]["sprint_fvp"], "config": record["sprintFvpConfig"],
            "analysis": record["sprintFvpAnalysis"],
            "selections": record["views"]["capabilitySelections"]}


def verify_exports(data, channel):
    items = {Path(item["path"]).name: item for item in data["artifacts"]}
    for item in items.values():
        verify_item(item)
    saved = data["saved"]
    require(saved["raw"] and saved["config"].get("methodVersion") == "samozino-2016-splits-v1",
            "Missing saved original splits or calculation method")
    require(saved["config"].get("sampleStepS") == .1 and saved["config"].get("rfAfterS") == .3
            and saved["config"].get("samplingWindow") == "terminal_time", "Saved sampling metadata changed")
    record_path = verify_item(items[channel + "-record.json"])
    require(subset(load(record_path)["record"]) == saved, "Downloaded record differs from saved settings")
    backup_path = verify_item(items[channel + "-backup.motionbench.jsonl"])
    rows = [json.loads(line) for line in backup_path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    if VERSION == "2.17.1-local":
        require(data.get("packageVersion") == VERSION, "Browser evidence has a different producer version")
        header = next(row for row in rows if row.get("type") == "header")
        config = next(row["value"] for row in rows if row.get("type") == "config")
        require(header["schema"] == config["schema"] == 3 and config.get("version") == VERSION,
                "Downloaded JSONL producer identity or schema differs")
    records = [row["value"] for row in rows if row.get("type") == "record"]
    require(any(subset(record) == saved for record in records), "JSONL does not retain the saved sprint record")
    editable = verify_item(items[channel + "-report.html"]).read_text(encoding="utf-8")
    require(inline_modules(editable), "Editable HTML does not contain the current modules")
    for suffix in ["template.xlsx", "filled.xlsx"]:
        with zipfile.ZipFile(verify_item(items[channel + "-" + suffix])) as workbook:
            require({"[Content_Types].xml", "xl/workbook.xml"} <= set(workbook.namelist()),
                    "Unreadable Excel artifact: " + suffix)
            require(workbook.testzip() is None, "Corrupted Excel artifact: " + suffix)
    return [artifact(item["path"]) for item in items.values()]


def verify_browser(data, channel):
    require(data.get("pass") is True and data.get("synthetic") is True
            and data.get("sourceUnchanged") is True and data.get("channel") == channel,
            "Sprint browser suite is incomplete: " + channel)
    expected = ACCEPTANCE[VERSION]["browserChecks"]
    require(len(data["checks"]) == expected and len(set(data["checks"])) == expected,
            f"Expected {expected} complete sprint scenarios: " + channel)
    require(data["errors"] == [] and data["network"] == [], "Browser errors or external requests: " + channel)
    require({row["width"] for row in data["layouts"]} == {1440, 900, 390}, "Missing tested screen widths")
    for row in data["layouts"]:
        require(row["pageOverflow"] is False and [card["id"] for card in row["cards"]] == DIRECTIONS,
                "Capability layout overflow or missing cards")
        require(all(card["metricCount"] == 1 and card["judgments"] == 1 for card in row["cards"]),
                "Capability card has duplicate metrics or judgments")
    exports = verify_exports(data, channel)
    pdf = data["pdf"]
    path = verify_item(pdf)
    require(path.read_bytes().startswith(b"%PDF-"), "Actual PDF bytes are missing")
    diagnostic = pdf["diagnostics"]
    require(diagnostic["status"] == "complete", "PDF export was incomplete")
    for key in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
        require(diagnostic[key] == [], "PDF diagnostic failed: " + key)
    require(diagnostic["textChecks"] and all(row["exact"] is True for row in diagnostic["textChecks"]),
            "PDF text was lost or changed")
    pages = pdf["pages"]
    require(pages and all(not page["overflow"] for page in pages), "PDF pages overflow")
    require([kind for page in pages for kind in page["charts"]].count("sprintFvp") == 1,
            "Sprint chart missing or duplicated in PDF")
    require([card for page in pages for card in page["directionCards"]] == DIRECTIONS,
            "PDF direction cards missing or duplicated")
    require(pdf["layoutAssertions"]["allTextChecksExact"] is True, "PDF heading text checks failed")
    return {"channel": channel, "checks": len(data["checks"]), "artifacts": exports,
            "layouts": data["layouts"], "pdf": artifact(path), "pdfPageCount": len(pages)}


def verify_visual(data, browsers, evidence):
    from pypdf import PdfReader

    require(data.get("pass") is True and data.get("synthetic") is True
            and data.get("allPagesVisuallyReviewed") is True and data.get("issues") == [],
            "Visual/PDF review is incomplete or has unresolved issues")
    require(len(data["pdfs"]) == 2 and {item["channel"] for item in data["pdfs"]} == set(CHANNELS),
            "Both browser PDFs must be visually reviewed")
    browser_map = {item["channel"]: item for item in browsers}
    pages_reviewed = 0
    for case in data["pdfs"]:
        channel = case["channel"]
        pdf_path = verify_item(case)
        require(artifact(pdf_path) == browser_map[channel]["pdf"], "Visual review references another PDF")
        page_count = len(PdfReader(pdf_path).pages)
        require(page_count == case["pageCount"] == browser_map[channel]["pdfPageCount"], "PDF page counts differ")
        require(case["reviewedPages"] == list(range(1, page_count + 1)), "Not every actual PDF page was reviewed")
        require(case["allTextChecksExact"] is True, "Visual evidence reports missing PDF text")
        require(1 <= case["cardioHeadingWithFirstRowPage"] <= page_count
                and 1 <= case["sprintRawTitlePage"] <= page_count, "Missing category or sprint raw appendix heading")
        render = load(case["renderResultsPath"])
        evidence[channel + "PDFRender"] = artifact(case["renderResultsPath"])
        require(local_path(render["pdf"]) == pdf_path and render["pdfSha256"] == digest(pdf_path),
                "Rendered evidence references another PDF")
        require([page["page"] for page in render["pages"]] == list(range(1, page_count + 1)), "Rendered page set differs")
        for page in render["pages"]:
            png = verify_item({"path": page["png"], "sha256": page["sha256"]})
            require(list(struct.unpack(">II", png.read_bytes()[16:24])) == page["size"], "Rendered PNG dimensions changed")
            require(page["inkBounds"] is not None, "Blank rendered PDF page")
            width, height = page["pdfPointSize"]
            require(abs(width - 595.28) < 2 and abs(height - 841.89) < 2, "PDF page is not A4")
        pages_reviewed += page_count
    require(data["screenshots"], "No visually reviewed screenshots")
    for channel in CHANNELS:
        require({390, 1440} <= {item["width"] for item in data["screenshots"] if item["channel"] == channel},
                "Missing desktop/narrow visual review: " + channel)
    for item in data["screenshots"]:
        verify_item(item)
    return pages_reviewed


def verify_science(modules, evidence):
    relative = "output/science-review-results.json"
    data = load(relative)
    evidence["independentScienceModules"] = artifact(relative)
    require(data["total"] > 0 and data["passed"] == data["total"] == len(data["checks"])
            and all(check["passed"] is True for check in data["checks"]), "Independent scientific checks failed")
    require(set(data["moduleSha256"]) == {"ringside-calc.js", "ringside-sprint-fvp.js"}, "Science evidence lacks module hashes")
    require(all(modules[name] == sha for name, sha in data["moduleSha256"].items()), "Science evidence used different modules")
    script = local_path(data["scriptPath"])
    require(script == local_path("tests/sprint-fvp-independent-checks.py"), "Scientific evidence must use the committed review script")
    require(data["scriptSha256"] == digest(script), "Scientific review script changed after execution")
    evidence["independentScienceScript"] = artifact(script)
    return {"scope": "Independent calculation modules; no direct final-HTML execution claim",
            "tool": data["independentTool"], "checks": data["total"],
            "moduleSha256": data["moduleSha256"], "scriptPath": data["scriptPath"], "scriptSha256": data["scriptSha256"]}


def verify_pdf_module(sha, evidence):
    directory = "output/pdf/v2.17.1-" + sha[:8]
    manifest = read_current(directory + "/evidence-manifest.json", sha, evidence, "pdfModuleManifest")
    require(manifest["version"] == VERSION and manifest["exitCode"] == 0 and manifest["passCount"] == 6,
            "Additional PDF module run did not complete all six checks")
    require(manifest["runnerSha256"] == digest(local_path("tests/pdf-module-tests.cjs"))
            and manifest["pdfSourceSha256"] == digest(local_path("src/ringside-pdf.js")),
            "PDF module run used different code")
    for item in manifest["files"]:
        path = verify_item({"path": directory + "/" + item["name"], "sha256": item["sha256"]})
        require(path.stat().st_size == item["bytes"], "PDF module artifact size changed")
    data = read_current(directory + "/module-test-results.json", sha, evidence, "pdfModule")
    require(data["browserErrors"] == [] and data["externalRequestsDuringExport"] == [],
            "PDF module run reported browser errors or external requests")
    for name in ("sample", "stress"):
        case = data[name]
        require(case["pages"] == manifest[name + "Pages"] and all(not row["overflow"] for row in case["captures"]),
                "PDF module page count differs or a page overflows")
        diagnostics = case["diagnostics"]
        require(diagnostics["status"] == "complete", "PDF module export was incomplete")
        for key in ("missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"):
            require(diagnostics[key] == [], "PDF module diagnostic failed: " + key)
        require(all(row["exact"] for row in diagnostics["textChecks"]), "PDF module text changed")
    return {"checks": 6, "samplePages": manifest["samplePages"], "stressPages": manifest["stressPages"],
            "scope": "Automated module checks; separate from visually reviewed sprint PDFs"}


def main():
    require(VERSION in ACCEPTANCE, "Unsupported version for the local verifier")
    html_path = local_path("MotionBench.html")
    sha = digest(html_path)
    require(digest(local_path("Ringside_Boxing_Assessment.html")) == sha, "The two standalone HTML files differ")
    subprocess.run([sys.executable, "scripts/build.py"], cwd=ROOT, check=True)
    require(digest(html_path) == sha and digest(local_path("Ringside_Boxing_Assessment.html")) == sha,
            "Rebuild changed the tested artifact; rerun acceptance against the new candidate")
    html = html_path.read_text(encoding="utf-8")
    modules = inline_modules(html)
    if VERSION == "2.17.1-local":
        require('window.RingsideBuild=Object.freeze(' + json.dumps({"version": VERSION}) + ');' in html,
                "Standalone producer identity differs from package.json")
    require(re.search(r'<script id="embedded-data" type="application/json">\s*null\s*</script>', html),
            "Standalone delivery unexpectedly contains a saved record")
    require(not re.search(r"sk-[A-Za-z0-9_-]{32,}", html), "Unexpected API-key-like value in delivery")
    evidence = {}
    unit = read_current("output/tests/unit-results.json", sha, evidence, "unit")
    suites = unit["suites"]
    expected = ACCEPTANCE[VERSION]["unitSuites"]
    require(len(suites) == expected and len({suite["name"] for suite in suites}) == expected,
            f"Expected {expected} unique unit suites")
    require(all(suite["exitCode"] == 0 and isinstance(suite["checksPassed"], int)
                and suite["checksPassed"] > 0 for suite in suites), "A unit suite did not pass")
    runner = local_path("tests/run-unit-tests.cjs").read_text(encoding="utf-8")
    suite_list = re.search(r"for \(const name of \[(.*?)\]\)", runner, re.S)
    require(suite_list is not None and set(re.findall(r'"([^"\n]+\.cjs)"', suite_list.group(1)))
            == {suite["name"] for suite in suites}, "Unit evidence differs from the current suite registry")
    evidence["unitRunner"] = artifact("tests/run-unit-tests.cjs")
    browsers = []
    for channel in CHANNELS:
        data = read_current(f"{ACCEPTANCE[VERSION]['browserDir']}/{channel}-results.json", sha, evidence, channel + "Sprint")
        browsers.append(verify_browser(data, channel))
    visual = read_current(ACCEPTANCE[VERSION]["browserDir"] + "/visual-review.json", sha, evidence, "visualReview")
    pages = verify_visual(visual, browsers, evidence)
    science = verify_science(modules, evidence)
    pdf_module = verify_pdf_module(sha, evidence) if VERSION == "2.17.1-local" else None
    historical = []
    legacy = ROOT / "output/tests/v217-legacy-browser-summary.json"
    if legacy.is_file():
        previous = load(legacy)
        historical.append({**artifact(legacy), "sourceHash": previous["sourceHash"],
            "reportedChecks": previous["totalChecksPassed"], "includedInCurrentAcceptance": False,
            "reason": "Archived DSI/evaluation runs are separately recorded, never substituted for final-candidate scenarios"})
    result = {"pass": True, "version": VERSION, "deliveryScope": "Local reviewable build; no release, merge or deployment",
        "completedAtUTC": datetime.now(timezone.utc).isoformat(), "html": html_path.name,
        "sha256": sha, "bytes": html_path.stat().st_size, "reproducibleBuild": True, "standaloneFilesEqual": True,
        "modules": modules, "evidence": evidence, "unitSuites": len(suites),
        "modelChecks": sum(suite["checksPassed"] for suite in suites),
        "browserWorkflowChecks": sum(browser["checks"] for browser in browsers), "browsers": browsers,
        "pdfFilesReviewed": len(visual["pdfs"]), "pdfPagesVisuallyReviewed": pages,
        "scientificModuleVerification": science, "additionalPdfModuleVerification": pdf_module, "historicalEvidence": historical,
        "verificationLimits": ["All acceptance records are synthetic; browser contexts are isolated and offline.",
            "Narrow screens use viewport emulation; physical devices and paper printing were not tested.",
            "User sprint workbook was not materialized on Windows; cached Library values are not original-formula/chart verification.",
            "Independent SciPy evidence verifies recorded calculation modules, not execution of the final standalone HTML.",
            "No native Microsoft Excel, live AI-provider quality or clean Windows installation claim is made.",
            *visual.get("limitations", [])]}
    (ROOT / "output/acceptance-manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    public = {key: result[key] for key in ["pass", "version", "deliveryScope", "completedAtUTC", "html", "sha256", "bytes",
        "reproducibleBuild", "standaloneFilesEqual", "unitSuites", "modelChecks", "browserWorkflowChecks",
        "pdfFilesReviewed", "pdfPagesVisuallyReviewed", "scientificModuleVerification", "additionalPdfModuleVerification", "verificationLimits"]}
    public["evidenceIndex"] = "output/acceptance-manifest.json"
    public["historicalEvidenceIncludedInCurrentAcceptance"] = False
    (ROOT / f"docs/acceptance-{VERSION}.json").write_text(json.dumps(public, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"PASS {VERSION}: {len(suites)} unit suites, {result['modelChecks']} model checks, "
          f"{result['browserWorkflowChecks']} Chrome/Edge scenarios, {pages} visually reviewed PDF pages")
    print(sha)


if __name__ == "__main__":
    main()
