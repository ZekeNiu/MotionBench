"""Verify 2.21.0 evidence without editing tests; --freeze records approved evidence."""
from pathlib import Path, PurePosixPath
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
VERSION, DESKTOP_VERSION = "2.21.0", "2.21.0-desktop.1"
DEST = ROOT / "docs/acceptance-2.21.0.json"
MANIFEST = ROOT / "output/acceptance-manifest.json"
EVIDENCE = {
    "unit": "output/tests/v2210/unit-results.json",
    "semantics": "output/tests/v2191-semantics/model-results.json",
    "visual": "output/implementation-2.20.0/report/pdf-visual-review.json",
    "desktopUnit": "output/tests/v2210-desktop/update-unit-results.json",
    "package": "output/desktop-package/package-check.json",
    "nativeSmoke": "output/tests/v220-desktop/packaged-native-smoke/results.json",
    "nativeUpdates": "output/tests/v220-desktop/packaged-native-updates/native-update-results.json",
    "nativeManagement": "output/desktop-v2210-management/packaged/native-management-results.json",
    "pdfRegressionVisual": "output/implementation-2.21.0/pdf/pdf-visual-review.json",
    "nativePdf": "output/tests/v2210-desktop/packaged-pdf/native-pdf-results.json",
}
BROWSER_SPECS = [
    ("management", "output/playwright/management-v220/{channel}-results.json", "management-v220-browser-tests.cjs", 12),
    ("app", "output/playwright/v220/app/{channel}-results.json", "app-v220-browser-tests.cjs", 7),
    ("storage", "output/playwright/v220/storage/{channel}.json", "storage-v220-browser-tests.cjs", 22),
    ("settings", "output/playwright/v2210/settings/{channel}.json", "desktop-settings-v2191-browser-tests.cjs", 9),
    ("report", "output/implementation-2.20.0/report/{channel}.json", "report-v220-browser-tests.cjs", 8),
]
CI_RESULTS = {
    "wizard": "output/tests/v220-desktop/installer-wizard/wizard-results.json",
    "upgrade": "output/tests/v2210-desktop/installed-upgrade/upgrade-results.json",
    "installed": "output/desktop-smoke/installed/results.json",
    "portable": "output/desktop-smoke/portable/results.json",
    "uninstall": "output/desktop-package/uninstall-data-check.json",
    "management": "output/desktop-v2210-management/packaged/native-management-results.json",
    "nativePdf": "output/tests/v2210-desktop/packaged-pdf/native-pdf-results.json",
}
BASELINE_FIXTURE = "tests/fixtures/desktop-upgrade-baseline-v220.json"
BASELINE_ARCHIVE_URL = "https://github.com/ZekeNiu/MotionBench/releases/download/rollback-v2.19.1-desktop.1-before-2.20.0-20261013/MotionBench-2.19.1-desktop.1-baseline.zip"
BASELINE_ARCHIVE_SHA256 = "151ec75c144d5b2be39628e79ba12debde4b68996ebf7d7c2d4532a1baa2427e"
PDF_CASES = [(3, 0), (7, 0), (7, 2), (1, 0)]
EXPECTED_UNIT_SUITES = 56  # Verified by the final registered-suite execution.
EXPECTED_UNIT_CHECKS = 861
CATALOG_CHECKS = 12
GENERIC_CHECKS = 10
GENERIC_RUNNER = "tests/generic-viz-v2210-browser-tests.cjs"
CATALOG_RUNNER = "tests/catalog-v2210-browser-tests.cjs"
CATALOG_PATTERN = "output/implementation-2.21.0/catalog/{channel}.json"
CATALOG_NATIVE = "output/tests/v2210-desktop/packaged-catalog/native.json"
GENERIC_PATTERN = "output/implementation-2.21.0/generic/{channel}.json"
GENERIC_NATIVE = "output/tests/v2210-desktop/packaged-generic/native.json"
GENERIC_VISUAL = "output/implementation-2.21.0/generic/generic-pdf-visual-review.json"
GENERIC_SCREENSHOT_VISUAL = "output/implementation-2.21.0/generic/generic-screenshot-visual-review.json"
STANDARDS_DOC = "docs/preset-tests-and-standards.md"
CI_NATIVE_SMOKE = "output/desktop-smoke/packaged/results.json"
NATIVE_EXECUTABLE = "dist-desktop/win-unpacked/MotionBench.exe"
EVIDENCE_TOOLS = {"scripts/verify_v2210.py", "scripts/verify_delivery.py", "scripts/package_v2210_evidence.py"}
PUBLIC_V220_HTML_SHA256 = "9fdac139dcad46a4f533877296f9000abdf9a91ec2d68fae1164453f9d19beae"


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


class EvidenceIndex:
    def __init__(self):
        self.files = {}

    def file(self, relative, expected=None, base=None):
        require(isinstance(relative, str) and relative and "\\" not in relative and ":" not in relative, "Invalid evidence path")
        logical = PurePosixPath(relative)
        require(not logical.is_absolute() and ".." not in logical.parts and logical.as_posix() == relative, "Noncanonical evidence path: " + relative)
        require(not (ROOT / (base or "") / relative).is_symlink(), "Evidence symlink is excluded: " + relative)
        path = (ROOT / (base or "") / relative).resolve()
        require(path.is_relative_to(ROOT), "Evidence escaped workspace: " + str(relative))
        require(path.is_file(), "Missing evidence file: " + str(path))
        key = path.relative_to(ROOT).as_posix()
        sha = digest(path)
        require(expected is None or sha == expected, "Stale or altered file: " + key)
        self.files[key] = {"path": key, "sha256": sha, "bytes": path.stat().st_size}
        return self.files[key]

    def item(self, item, base=None):
        return self.file(item.get("path", item.get("file")), item["sha256"], base)

    def read(self, relative, base=None):
        item = self.file(relative, base=base)
        return json.loads((ROOT / item["path"]).read_text(encoding="utf-8-sig"))


def source_identity(data):
    values = [data[key] for key in ["sourceHash", "sourceSha256", "sourceHtmlSha256", "htmlSha256", "artifactSHA256"] if key in data]
    require(len(set(values)) <= 1, "Conflicting source HTML hashes in evidence")
    return values[0] if values else None


def verify_source(index):
    package = index.read("package.json")
    require(package["version"] == VERSION, "Wrong web version")
    artifact = index.file("MotionBench.html")
    html = (ROOT / artifact["path"]).read_text(encoding="utf-8")
    require(not (ROOT / "Ringside_Boxing_Assessment.html").exists(), "Retired HTML entry was recreated")
    require(re.search(r'<script id="embedded-data" type="application/json">\s*null\s*</script>', html), "Daily HTML embeds athlete data")
    require(not re.search(r"sk-[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{30,}", html), "Credential-like token in daily HTML")
    inputs = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "src").glob("*") if p.is_file())
    inputs += ["scripts/build.py", "package.json", "vendor/versions.json", "body-map-front.png"]
    vendor = index.read("vendor/versions.json")
    for dependency in vendor["dependencies"]:
        for file_key, hash_key in [("file", "sha256"), ("license_file", "license_sha256")]:
            relative = "vendor/" + dependency[file_key]
            index.file(relative, dependency[hash_key]); inputs.append(relative)
    hashes = {name: index.file(name)["sha256"] for name in sorted(set(inputs))}
    # Build in a disposable directory, leaving the tested workspace HTML untouched.
    with tempfile.TemporaryDirectory(prefix="motionbench-verify-221-") as temporary:
        folder = Path(temporary)
        for name in hashes:
            target = folder / name; target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        subprocess.run([sys.executable, str(folder / "scripts/build.py")], cwd=folder, check=True, capture_output=True, text=True)
        require(digest(folder / "MotionBench.html") == artifact["sha256"], "Source build differs from tested HTML")
    for name, expected in hashes.items():
        index.file(name, expected)
    return artifact, hashes


def verify_units(index, source_hash):
    require(EXPECTED_UNIT_SUITES is not None and EXPECTED_UNIT_CHECKS is not None, "2.21.0 unit inventory is pending actual registered-suite execution")
    unit = index.read(EVIDENCE["unit"])
    require(unit["sourceHash"] == source_hash and unit["sourceUnchanged"], "Stale unit evidence")
    index.file("tests/run-unit-tests.cjs", unit["runnerSha256"])
    registered = re.findall(r'^\s*"([^"\n]+\.cjs)",\s*$', (ROOT / "tests/run-unit-tests.cjs").read_text(encoding="utf-8"), re.M)
    require({"presets-v2210-model-tests.cjs", "generic-viz-v2210-model-tests.cjs"} <= set(registered), "Registered units omitted the new production contracts")
    require(len(unit["suites"]) == EXPECTED_UNIT_SUITES and [s["name"] for s in unit["suites"]] == registered, "Unit suite list differs from frozen runner")
    require(sum(s["checksPassed"] for s in unit["suites"]) == EXPECTED_UNIT_CHECKS, "Unit check coverage differs from approved inventory")
    require(set(unit["modules"]) == {p.name for p in (ROOT / "src").glob("*.js")}, "Unit evidence omitted a source module")
    for name, expected in unit["modules"].items():
        index.file("src/" + name, expected)
    for suite in unit["suites"]:
        require(suite["exitCode"] == 0 and suite["sourceUnchanged"], "Failed or changed suite: " + suite["name"])
        index.file("tests/" + suite["name"], suite["sha256"])
        reported = re.search(r"(\d+) [^\n]*checks passed", suite["stdout"]) or re.search(r"PASS (\d+) athlete context (?:model|Excel) scenarios", suite["stdout"])
        require(reported and int(reported.group(1)) == suite["checksPassed"] > 0, "Invalid suite count: " + suite["name"])
    semantics = index.read(EVIDENCE["semantics"])
    for name, expected in semantics["sourceHashes"].items():
        index.file(name, expected)
    index.file("tests/report-semantics-v2191-model-tests.cjs", semantics["testSha256"])
    require(semantics["ruleId"] == "eur-height-1.1-v1" and semantics["checksPassed"] == 18, "Missing approved EUR verification")
    approved = index.read("tests/fixtures/capability-direction-values-v2191.json")
    policy = approved["approvedJudgmentPolicy"]
    index.file("tests/fixtures/" + policy["numericBaselineFile"], policy["numericBaselineSha256"])
    old = index.read("tests/fixtures/" + policy["numericBaselineFile"])
    scientific = lambda fixture: [{"name": c["name"], "directions": [{k: v for k, v in m.items() if k != "judgment"} for m in c["directions"]]} for c in fixture["cases"]]
    require(scientific(approved) == scientific(old), "Direction wording update changed the independent numerical baseline")
    for folder in ["tests/helpers", "tests/fixtures"]:
        for dependency in sorted((ROOT / folder).glob("*")):
            if dependency.is_file():
                index.file(dependency.relative_to(ROOT).as_posix())
    return {**index.file(EVIDENCE["unit"]), "suites": len(unit["suites"]), "checks": sum(s["checksPassed"] for s in unit["suites"])}


def verify_browsers(index, source_hash):
    browsers, pdfs = [], {}
    for name, pattern, runner, count in BROWSER_SPECS:
        for channel in ["chrome", "msedge"]:
            relative = pattern.format(channel=channel); data = index.read(relative)
            require(data["pass"] is True and data["sourceUnchanged"] is True and source_identity(data) == source_hash, "Stale/failed browser evidence: " + relative)
            index.file("tests/" + runner, data["runnerSha256"])
            require(data["channel"] == channel and len(data["checks"]) == count and not data["errors"] and not data.get("network") and not data.get("failure") and not data.get("error"), "Browser checks failed: " + relative)
            for item in data.get("artifacts", []) + data.get("screenshots", []):
                index.item(item)
            for key in ["moduleHashes", "sourceHashes"]:
                for filename, expected in data.get(key, {}).items():
                    index.file(filename, expected)
            if name == "management":
                # This runner creates exactly these images, but its receipt does
                # not declare their hashes. Freeze their actual bytes explicitly.
                for width in [1440, 1024, 390]:
                    for view in ["catalog", "projects", "aggregations", "preview"]:
                        index.file(f"output/playwright/management-v220/{channel}-{view}-{width}.png")
            if name == "storage":
                require(data["synthetic"] is True and data["mode"] == "product-html", "Storage receipt did not exercise the product HTML")
                backup = index.file(f"output/playwright/v220/storage/{channel}-roundtrip.motionbench.jsonl")
                rows = [json.loads(line) for line in (ROOT / backup["path"]).read_text(encoding="utf-8").splitlines() if line.strip()]
                require({"record", "profile"} <= {row.get("type") for row in rows}, "Storage roundtrip lacks raw records or schemes")
            if name == "report":
                require(data["synthetic"] is True and len(data["pdfs"]) == 2, "Missing primary/mean actual PDF export")
                heading = data["headingEvidence"]
                require(heading["headingCount"] == 1, "Duplicate capability heading")
                capability, normal = heading["h3"], heading["normalH3"]
                require(capability["tag"] == normal["tag"] == "H3" and capability["font"] == normal["font"] == "16px", "Capability title hierarchy/font differs")
                require(capability["color"] == normal["color"] == "rgb(69, 84, 106)", "Capability heading text appearance differs")
                require(heading["heading"]["background"] == heading["normal"]["background"] == "rgb(247, 249, 252)" and abs(heading["heading"]["width"] - heading["normal"]["width"]) <= 4, "Capability heading background/width differs")
                for key in ["font", "color", "background", "padding", "radius", "shadow"]:
                    require(heading["card"][key] == heading["normalCard"][key], "Capability card differs: " + key)
                require(heading["cardTitle"]["tag"] == heading["normalTitle"]["tag"] == "H4" and heading["cardTitle"]["font"] == heading["normalTitle"]["font"], "Capability card title differs")
                for pdf in data["pdfs"]:
                    index.item(pdf); diagnostic = pdf["diagnostics"]
                    require(diagnostic["status"] == "complete", "Incomplete PDF: " + pdf["file"])
                    for key in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
                        require(not diagnostic[key], "PDF integrity failure: " + key)
                    require(not any(page.get("overflow") for page in pdf["pages"]), "PDF page overflow")
                    require(pdf["file"] not in pdfs, "Duplicate actual PDF")
                    pdfs[pdf["file"]] = pdf
            browsers.append({"name": name, "channel": channel, "checks": count, **index.file(relative)})
    require(sum(item["checks"] for item in browsers) == 116, "Unexpected browser coverage")
    return browsers, pdfs


def poppler_executable():
    import os
    specified = os.environ.get("MOTIONBENCH_PDFTOPPM")
    candidate = specified or shutil.which("pdftoppm")
    if not candidate:
        candidates = sorted((Path.home() / ".cache/codex-runtimes").glob("*/dependencies/native/poppler/Library/bin/pdftoppm.exe"))
        candidate = str(candidates[-1]) if candidates else None
    require(candidate and Path(candidate).is_file(), "PDF pixel verification requires Poppler pdftoppm (PATH or MOTIONBENCH_PDFTOPPM)")
    return candidate


def verify_pdf(index, source_hash, pdfs):
    from PIL import Image, ImageStat
    from pypdf import PdfReader
    visual = index.read(EVIDENCE["visual"])
    require(visual["pass"] is True and visual["synthetic"] is True and source_identity(visual) == source_hash, "Stale PDF visual receipt")
    require(len(visual["pdfs"]) == len(pdfs) == 4, "Incomplete report PDF visual coverage")
    require({item["file"] for item in visual["pdfs"]} == set(pdfs), "Visual review covers another set of PDFs")
    renderer = poppler_executable(); total = 0
    for reviewed in visual["pdfs"]:
        pdf = pdfs[reviewed["file"]]; item = index.item(reviewed)
        require(reviewed["sha256"] == pdf["sha256"] and reviewed["pass"] is True, "PDF export and visual receipt differ")
        reader = PdfReader(ROOT / item["path"])
        expected = len(pdf["pages"])
        require(expected > 0, "Report PDF has no actual pages")
        require(len(reader.pages) == len(reviewed["pages"]) == len(pdf["pages"]) == pdf["diagnostics"]["pageCount"] == expected, "Actual PDF page count differs")
        require([page["page"] for page in reviewed["pages"]] == list(range(1, expected + 1)), "Visual page order differs")
        for page in reader.pages:
            require(abs(float(page.mediabox.width) - 595.28) < 1 and abs(float(page.mediabox.height) - 841.89) < 1, "Actual PDF is not A4")
        with tempfile.TemporaryDirectory(prefix="motionbench-pdf-221-") as temporary:
            prefix = Path(temporary) / "page"
            subprocess.run([renderer, "-scale-to", "1500", "-png", str(ROOT / item["path"]), str(prefix)], check=True, capture_output=True)
            rendered = {int(path.stem.rsplit("-", 1)[1]): path for path in Path(temporary).glob("page-*.png")}
            require(sorted(rendered) == list(range(1, expected + 1)), "Poppler omitted or added report pages")
            for page in reviewed["pages"]:
                image = index.item(page)
                require(page["pass"] is True and page["reviewed"] is True, "Unreviewed PDF page")
                with Image.open(ROOT / image["path"]) as saved, Image.open(rendered[page["page"]]) as actual:
                    saved, actual = saved.convert("RGB"), actual.convert("RGB")
                    require(list(saved.size) == page["size"] == list(actual.size) and saved.tobytes() == actual.tobytes(), "Reviewed image differs from actual PDF page: " + image["path"])
                    require(max(ImageStat.Stat(saved).stddev) > 5, "Blank rendered PDF page")
                total += 1
    require(total == visual["pagesReviewed"], "PDF visual coverage omitted actual pages")
    return {"files": 4, "pages": total, "reviewedPages": total, "freshRenderPixelComparisons": total, "directlyRecheckedAffectedPages": visual["directlyRecheckedAffectedPages"], "visualEvidence": index.file(EVIDENCE["visual"])}


def verify_native_identity(index, identity, source_hash, runner, archive_hash=None):
    hosts = {p.relative_to(ROOT).as_posix() for p in (ROOT / "desktop").glob("*.cjs")}
    require(set(identity["sourceHashes"]) == hosts | {"package.json", "package-lock.json", "electron-builder.yml"}, "Native evidence omitted source/config modules")
    require(set(identity["runtimeHashes"]) == hosts | {"package.json"}, "Native evidence omitted runtime modules")
    require(identity["sourceHtmlSha256"] == identity["runtimeHtmlSha256"] == source_hash and identity["runtimeMatchesSourceHtml"] is True, "Stale native HTML")
    require(re.fullmatch(r"[a-f0-9]{64}", identity["archiveSha256"]), "Invalid native archive identity")
    require(archive_hash is None or identity["archiveSha256"] == archive_hash, "Native ASAR differs from delivered archive")
    index.file("tests/" + runner, identity["testScriptSha256"])
    index.file("tests/helpers/desktop-artifact-identity.cjs", identity["identityHelperSha256"])
    for name, expected in identity["sourceHashes"].items():
        index.file(name, expected)
    for name in hosts:
        index.file(name, identity["runtimeHashes"][name])


def verify_pagination_fixture(fixture, axes, members):
    require(fixture["count"] == axes and fixture["meanMembers"] == members and len(fixture["axes"]) == axes and fixture["scoreTables"] == axes, "PDF fixture does not exercise the required ability/member count")
    require(fixture["hasRadar"] is (axes >= 3) and fixture["hasComparison"] is (axes == 1), "PDF fixture uses another overview mode")
    require(len(fixture["rows"]) == axes - (1 if members else 0) + members, "PDF fixture omitted detail rows")
    require(fixture["recordId"] == f"synthetic-v221-pdf-{axes}-{members}" and fixture["athleteId"] == "synthetic-v221-pdf-athlete", "PDF fixture is not the independent synthetic record")
    require(fixture["narrative"] == "Synthetic manual narrative remains complete after multi-axis PDF pagination.", "PDF fixture omitted the manual narrative")
    for axis in fixture["axes"]:
        require(abs(axis["value"] - 50) < 1e-8 and all(abs(score - 50) < 1e-8 for score in axis["scores"]), "PDF pagination changed the independently expected score")


def verify_pagination_export(index, pdf, fixture, base=None):
    from pypdf import PdfReader
    item = index.item(pdf, base)
    diagnostic = pdf["diagnostics"]
    require(diagnostic["status"] == "complete" and pdf["leakedStages"] == 0, "Pagination export failed or leaked its staging DOM")
    for key in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
        require(diagnostic[key] == [], "Pagination integrity failure: " + key)
    require(diagnostic["rowCount"] == diagnostic["renderedRowCount"], "Pagination changed the number of raw rows")
    require(all(check["exact"] or check.get("keepWithNext") and check["renderedCharacters"] == 0 for check in diagnostic["textChecks"]), "Pagination omitted or changed report text")
    pages = pdf["pages"]
    reader = PdfReader(ROOT / item["path"])
    require(len(reader.pages) == len(pages) == diagnostic["pageCount"] > 0, "Pagination receipt differs from actual PDF pages")
    for page in reader.pages:
        require(abs(float(page.mediabox.width) - 595.28) < 1 and abs(float(page.mediabox.height) - 841.89) < 1, "Pagination PDF is not A4")
    require([row for page in pages for row in page["rows"]] == fixture["rows"], "Pagination changed, lost or repeated a score-detail cell")
    require(all(page["overflow"] == [] for page in pages), "PDF content extends outside a page")
    for page in pages:
        require(page["body"]["width"] > 0 and page["body"]["height"] > 0, "Pagination used an empty page area")
        for chart in page["charts"]:
            require(chart["rect"]["width"] > 0 and chart["rect"]["height"] > 0 and chart["naturalWidth"] > 0 and chart["naturalHeight"] > 0, "Pagination lost chart artwork")
            require(not chart["originalHeight"] or chart["rect"]["height"] >= chart["originalHeight"] * .85 - .1, "Pagination made a chart unreadably small")
    require(pdf["live"] == {"raw": fixture["raw"], "narrative": fixture["narrative"], "recordId": fixture["recordId"], "athleteId": fixture["athleteId"], "profileId": fixture["profileId"], "folds": fixture["foldState"]}, "Export changed saved measurements, narrative, identity or fold settings")
    require(fixture["narrative"] in "".join(page["text"] for page in pages), "Manual narrative is missing from the PDF")
    if fixture["hasRadar"]:
        heading_pages = [page for page in pages if page["overviewHeads"]]
        require(len(heading_pages) == 1 and sum(len(page["overviewHeads"]) for page in pages) == 1, "Overview heading was lost or repeated")
        require(any(int(chart["index"]) == fixture["radarChartIndex"] for chart in heading_pages[0]["charts"]), "Overview heading and its radar were separated across pages")
    tables = [table for page in pages for table in page["tables"]]
    require(all("给分方式" in table["header"] for table in tables), "A score-detail table omitted its header")
    if fixture["meanMembers"] >= 30:
        indexes = [table["index"] for table in tables]
        require(any(indexes.count(index) > 1 for index in indexes) and all("给分方式" in table["header"] for table in tables), "Long parameter table omitted its repeated header")
    if fixture["count"] == 1:
        require(sum(page["wholeOverviewCards"] for page in pages) == 1, "A short overview was unnecessarily split")
    return item


def verify_pagination_browser(index, source_hash, channel, base=None):
    relative = f"output/implementation-2.21.0/pdf/{channel}.json"
    data = index.read(relative, base)
    require(data["pass"] is True and data["synthetic"] is True and data["baseline"] is False and data["sourceUnchanged"] is True and source_identity(data) == source_hash and data["channel"] == channel, "Stale/failed pagination browser receipt")
    require(len(data["checks"]) == 8 and not data["errors"] and not data["network"] and not data.get("failure"), "Pagination browser checks failed")
    index.file("tests/pdf-multiaxis-v221-browser-tests.cjs", data["runnerSha256"])
    require(set(data["helperHashes"]) == {"tests/helpers/playwright.cjs", "tests/helpers/pdf-browser.cjs"}, "Pagination runner omitted helper identities")
    for name, expected in data["helperHashes"].items():
        index.file(name, expected)
    require(len(data["fixtures"]) == len(data["pdfs"]) == len(PDF_CASES), "Pagination browser omitted a required fixture")
    for fixture, pdf, (axes, members) in zip(data["fixtures"], data["pdfs"], PDF_CASES):
        verify_pagination_fixture(fixture, axes, members)
        require(pdf["axisCount"] == axes and pdf["meanMembers"] == members, "PDF was matched to another fixture")
        verify_pagination_export(index, pdf, fixture, base)
    return data


def verify_pagination_baseline(index, channel):
    relative = f"output/implementation-2.21.0/pdf/baseline-{channel}.json"
    data = index.read(relative)
    require(data["pass"] is True and data["synthetic"] is True and data["baseline"] is True and data["sourceUnchanged"] is True and source_identity(data) == PUBLIC_V220_HTML_SHA256 and data["channel"] == channel, "Old public PDF failure was not independently reproduced")
    require(len(data["checks"]) == 4 and len(data["fixtures"]) == 2 and data["pdfs"] == [] and not data["errors"] and not data["network"] and not data.get("failure"), "Old public reproduction is incomplete")
    index.file("tests/pdf-multiaxis-v221-browser-tests.cjs", data["runnerSha256"])
    index.item(data["baselineHtml"])
    require(set(data["helperHashes"]) == {"tests/helpers/playwright.cjs", "tests/helpers/pdf-browser.cjs"}, "Old PDF reproduction omitted helper identities")
    for name, expected in data["helperHashes"].items():
        index.file(name, expected)
    require(data["baselineHtml"]["sha256"] == PUBLIC_V220_HTML_SHA256, "Reproduction used another old HTML")
    require(hashlib.sha256(subprocess.check_output(["git", "show", "v2.20.0:MotionBench.html"], cwd=ROOT)).hexdigest() == PUBLIC_V220_HTML_SHA256, "Old public Git tag differs from its immutable artifact")
    for fixture, (axes, members) in zip(data["fixtures"], PDF_CASES[:2]):
        verify_pagination_fixture(fixture, axes, members)
        failure = fixture["expectedFailure"]
        require(failure["status"] == "failed" and "PDF 中有超过一页的图表或卡片" in failure["error"] and failure["stages"] == 0 and failure["raw"] == fixture["raw"] and failure["narrative"] == fixture["narrative"], "Old PDF reproduction changed data or failed for another reason")
    return index.file(relative)


def verify_pagination_visual(index, source_hash, pdfs):
    from PIL import Image, ImageStat
    from pypdf import PdfReader
    visual = index.read(EVIDENCE["pdfRegressionVisual"])
    require(visual["pass"] is True and visual["synthetic"] is True and source_identity(visual) == source_hash, "Stale multi-axis PDF visual review")
    require(len(visual["pdfs"]) == len(pdfs) and {item["file"] for item in visual["pdfs"]} == set(pdfs), "Multi-axis visual review omitted or substituted a PDF")
    renderer, total = poppler_executable(), 0
    for reviewed in visual["pdfs"]:
        pdf = pdfs[reviewed["file"]]
        item = index.item(reviewed)
        require(reviewed["pass"] is True and reviewed["sha256"] == pdf["sha256"], "Reviewed pagination PDF differs from the actual export")
        reader = PdfReader(ROOT / item["path"])
        expected = len(reader.pages)
        require(expected == len(reviewed["pages"]) == len(pdf["pages"]) == pdf["diagnostics"]["pageCount"] > 0, "Multi-axis visual coverage omitted pages")
        require([page["page"] for page in reviewed["pages"]] == list(range(1, expected + 1)), "Multi-axis visual page order differs")
        with tempfile.TemporaryDirectory(prefix="motionbench-pagination-pdf-221-") as temporary:
            prefix = Path(temporary) / "page"
            subprocess.run([renderer, "-scale-to", "1500", "-png", str(ROOT / item["path"]), str(prefix)], check=True, capture_output=True)
            rendered = {int(path.stem.rsplit("-", 1)[1]): path for path in Path(temporary).glob("page-*.png")}
            require(sorted(rendered) == list(range(1, expected + 1)), "Poppler omitted or added multi-axis pages")
            for page in reviewed["pages"]:
                image = index.item(page)
                require(page["pass"] is True and page["reviewed"] is True, "Unreviewed multi-axis PDF page")
                with Image.open(ROOT / image["path"]) as saved, Image.open(rendered[page["page"]]) as actual:
                    saved, actual = saved.convert("RGB"), actual.convert("RGB")
                    require(list(saved.size) == page["size"] == list(actual.size) and saved.tobytes() == actual.tobytes(), "Reviewed image differs from actual multi-axis PDF page: " + image["path"])
                    require(max(ImageStat.Stat(saved).stddev) > 5, "Blank multi-axis PDF page")
                total += 1
    require(total == visual["pagesReviewed"], "Multi-axis review page count differs")
    return {"files": len(pdfs), "pages": total, "reviewedPages": total, "freshRenderPixelComparisons": total, "visualEvidence": index.file(EVIDENCE["pdfRegressionVisual"])}


def verify_pagination_native(index, source_hash, archive_hash, base=None, executable_hash=None):
    relative = EVIDENCE["nativePdf"]
    data = index.read(relative, base)
    require(data["pass"] is True and data["synthetic"] is True and data["packaged"] is True and data["platform"] == "win32", "Pagination was not exercised in the real packaged Windows application")
    require(len(data["checks"]) == 4 and not data["errors"] and not data["network"] and not data.get("failure") and data["artifactUnchanged"] is True and data["identity"] == data["finalIdentity"], "Native PDF checks failed or changed their runtime")
    require(data["sourceHash"] == source_hash and data["sourceUnchanged"] is True and data["isolatedProfile"] is True and data["temporaryProfileRemoved"] is True and not data.get("cleanupFailure"), "Native PDF profile is not isolated or source/cleanup changed")
    require(data["versions"] == {"desktop": DESKTOP_VERSION, "web": VERSION, "build": VERSION}, "Native PDF renderer has another version")
    require(re.fullmatch(r"[a-f0-9]{64}", data["executableSha256"]) and (executable_hash is None or data["executableSha256"] == executable_hash), "Native PDF used another executable")
    index.file("tests/pdf-multiaxis-v221-browser-tests.cjs", data["fixtureHelperSha256"])
    verify_native_identity(index, data["identity"], source_hash, "desktop-v221-pdf-tests.cjs", archive_hash)
    require(len(data["fixtures"]) == len(data["pdfs"]) == 2, "Native PDF omitted the three-axis or seven-axis real export")
    for fixture, pdf, (axes, members) in zip(data["fixtures"], data["pdfs"], PDF_CASES[:2]):
        verify_pagination_fixture(fixture, axes, members)
        require(pdf["axisCount"] == axes and pdf["meanMembers"] == members, "Native PDF was matched to another fixture")
        verify_pagination_export(index, pdf, fixture, base)
    for item in data.get("artifacts", []):
        index.item(item, Path(base or "") / Path(relative).parent)
    return data


def native_smoke_selection(evidence, require_ci, local_stage, artifact_root):
    if evidence is None:
        return {"origin": "local", "relative": EVIDENCE["nativeSmoke"], "base": None}
    require(require_ci and not local_stage, "Explicit CI native smoke evidence requires --require-ci and excludes --local-stage")
    require(isinstance(artifact_root, str) and artifact_root and "\\" not in artifact_root and ":" not in artifact_root, "Explicit CI native smoke requires a canonical repository-relative CI artifact root")
    logical = PurePosixPath(artifact_root)
    require(not logical.is_absolute() and ".." not in logical.parts and logical.as_posix() == artifact_root, "Invalid CI artifact root for native smoke")
    require(evidence == (logical / CI_NATIVE_SMOKE).as_posix(), "CI native smoke must be the packaged receipt under the selected CI artifact root")
    return {"origin": "ci", "relative": CI_NATIVE_SMOKE, "base": artifact_root}


def verify_smoke_lifecycle(data):
    cleanup = data["cleanup"]
    require(cleanup["temporaryProfileRemoved"] is True and cleanup["sessions"] == [] and cleanup["errors"] == [], "Native smoke did not normally close every owned process and remove its private profiles")
    windows = data["windows"]
    require([window["session"] for window in windows] == ["first-process", "restarted-process", "invalid-draft-restart", "fresh-recovery-process"] and len({window["nativePid"] for window in windows}) == 4, "Native smoke omitted a real independent restart or recovery process")
    require(data["platform"] == "win32" and data["native"]["appVersion"] == DESKTOP_VERSION, "Native smoke ran another platform or desktop version")


def verify_desktop(index, source_hash, smoke_selection=None):
    smoke_selection = smoke_selection or native_smoke_selection(None, False, False, "")
    unit = index.read(EVIDENCE["desktopUnit"])
    require(unit["passed"] is True and len(unit["checks"]) == 23, "Desktop update unit checks failed")
    index.file("tests/desktop-update-tests.cjs", unit["testScriptSha256"])
    require(set(unit["sourceHashes"]) == {"desktop/preferences.cjs", "desktop/update-service.cjs", "desktop/update-bridge.cjs", "desktop/windows-updater.cjs", "desktop/preload.cjs"}, "Incomplete desktop-unit source binding")
    for name, expected in unit["sourceHashes"].items():
        index.file(name, expected)
    package = index.read(EVIDENCE["package"])
    require(package["version"] == DESKTOP_VERSION and package["webVersion"] == VERSION and not package["directoryOnly"] and package["updaterConfigurationPresent"], "Incomplete production desktop package")
    archive = index.file("dist-desktop/win-unpacked/resources/app.asar", package["archiveSha256"])
    executable = index.file(NATIVE_EXECUTABLE)
    index.file("dist-desktop/win-unpacked/resources/app-update.yml")
    script = """const fs=require('fs'),path=require('path'),crypto=require('crypto'),asar=require('@electron/asar'),yaml=require('js-yaml');const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),a=path.resolve('dist-desktop/win-unpacked/resources/app.asar');const names=asar.listPackage(a).map(x=>x.replace(/\\\\/g,'/').replace(/^\\//,''));const files=names.filter(x=>!asar.statFile(a,path.normalize(x)).files).sort();const runtimeFiles=fs.readdirSync('desktop').filter(x=>x.endsWith('.cjs')).sort();console.log(JSON.stringify({files,package:JSON.parse(asar.extractFile(a,path.normalize('package.json')).toString('utf8')),runtimeHashes:Object.fromEntries(runtimeFiles.map(n=>['desktop/'+n,hash(asar.extractFile(a,path.normalize('desktop/'+n)))])),htmlSha256:hash(asar.extractFile(a,path.normalize('MotionBench.html'))),updater:yaml.load(fs.readFileSync('dist-desktop/win-unpacked/resources/app-update.yml','utf8'))}));"""
    packed = json.loads(subprocess.check_output(["node", "-e", script], cwd=ROOT, text=True))
    require(packed["files"] == package["files"] and packed["htmlSha256"] == source_hash, "Actual ASAR differs from inspected package")
    require(packed["package"]["version"] == DESKTOP_VERSION and packed["package"]["webVersion"] == VERSION, "Wrong embedded desktop/web versions")
    for key, expected in {"provider": "github", "owner": "ZekeNiu", "repo": "MotionBench", "channel": "desktop"}.items():
        require(packed["updater"][key] == expected, "Wrong desktop update feed: " + key)
    for name, expected in packed["runtimeHashes"].items():
        index.file(name, expected)
    results = []
    for key, runner, count in [("nativeSmoke", "desktop-smoke.cjs", 16), ("nativeUpdates", "desktop-updates-native-tests.cjs", 5), ("nativeManagement", "desktop-v2210-management-tests.cjs", 12)]:
        relative = smoke_selection["relative"] if key == "nativeSmoke" else EVIDENCE[key]
        base = smoke_selection["base"] if key == "nativeSmoke" else None
        data = index.read(relative, base)
        require(data.get("pass", data.get("passed")) is True and data["packaged"] is True and data["synthetic"] is True and len(data["checks"]) == count and not data.get("errors") and not data.get("network") and not data.get("failure") and data["artifactUnchanged"] is True and data["identity"] == data["finalIdentity"], "Native checks failed: " + relative)
        identities = [data["identity"]] + ([data["finalIdentity"]] if "finalIdentity" in data else [])
        for identity in identities:
            verify_native_identity(index, identity, source_hash, runner, archive["sha256"])
            require(identity["sourceHtmlSha256"] == identity["runtimeHtmlSha256"] == source_hash and identity["runtimeMatchesSourceHtml"] and identity["archiveSha256"] == archive["sha256"], "Stale native runtime")
            index.file("tests/" + runner, identity["testScriptSha256"])
            index.file("tests/helpers/desktop-artifact-identity.cjs", identity["identityHelperSha256"])
            for name, expected in identity["sourceHashes"].items():
                index.file(name, expected)
            require({k: v for k, v in identity["runtimeHashes"].items() if k != "package.json"} == packed["runtimeHashes"], "Native runtime module inventory changed")
        for item in data.get("artifacts", []):
            index.item(item, Path(base or "") / Path(relative).parent)
        if key == "nativeSmoke":
            verify_smoke_lifecycle(data)
        if key == "nativeManagement":
            require(data["cleanup"]["temporaryProfileRemoved"] is True and data["cleanup"]["sessions"] == [] and data["cleanup"]["errors"] == [], "Native management did not normally close its owned sessions and remove the private profile")
            require(data["executableSha256"] == executable["sha256"], "Native management used another executable")
            require(data["versions"]["desktop"] == DESKTOP_VERSION and data["versions"]["web"] == VERSION, "Native management versions differ")
            require([session["label"] for session in data["sessions"]] == ["initial", "reopened"] and all(session["isolatedUserData"] for session in data["sessions"]) and data["sessions"][0]["nativePid"] != data["sessions"][1]["nativePid"], "Native management did not restart in a separate isolated process")
            require(len(data["artifacts"]) == 12 and data["blockedNativeClose"]["windowAlive"] is True, "Native management lacks screenshots or exit protection")
        results.append({"name": key, "checks": count, "origin": smoke_selection["origin"] if key == "nativeSmoke" else "local", **index.file(relative, base=base)})
    return {"unitChecks": len(unit["checks"]), "nativeChecks": 33, "archive": archive, "executable": executable, "unitEvidence": index.file(EVIDENCE["desktopUnit"]), "packageEvidence": index.file(EVIDENCE["package"]), "native": results}



def verify_declared_file(index, item, base=None):
    checked = index.item(item, base)
    require(item.get("bytes") == checked["bytes"], "Declared artifact byte count differs: " + checked["path"])
    return checked


def verify_catalog_browser(index, source_hash, channel, base=None, archive_hash=None, executable_hash=None):
    require(CATALOG_CHECKS is not None, "2.21.0 catalog check inventory is pending the final runner")
    relative = CATALOG_NATIVE if channel == "native" else CATALOG_PATTERN.format(channel=channel)
    data = index.read(relative, base)
    require(data["pass"] is True and data["synthetic"] is True and data["sourceUnchanged"] is True and source_identity(data) == source_hash and data["channel"] == channel, "Stale or failed preset/chart-management browser receipt")
    require(len(data["checks"]) == CATALOG_CHECKS and len(set(data["checks"])) == CATALOG_CHECKS and not data["errors"] and not data["network"] and not data.get("failure"), "Catalog UI coverage differs from the final meaningful checks")
    index.file(CATALOG_RUNNER, data["runnerSha256"])
    if channel == "native":
        require(data["packaged"] is True and data["platform"] == "win32" and data["identity"] == data["finalIdentity"] and data["artifactUnchanged"] is True, "Catalog controls were not tested in the unchanged actual Windows package")
        require(data["normalClose"] is True and data["isolatedProfileRemoved"] is True and data["isolatedUserData"] is True and data["isolatedSessionData"] is True and data["actualWindowResize"] is True and not data.get("cleanupFailure"), "Catalog native profile isolation, actual window resize or normal close failed")
        require(data["versions"] == {"desktop": DESKTOP_VERSION, "web": VERSION}, "Catalog native versions differ from the candidate")
        require(re.fullmatch(r"[a-f0-9]{64}", data["executableSha256"]) and (executable_hash is None or data["executableSha256"] == executable_hash), "Catalog UI used another executable")
        verify_native_identity(index, data["identity"], source_hash, Path(CATALOG_RUNNER).name, archive_hash)
    screenshots = data.get("artifacts", []) + data.get("screenshots", [])
    require(len(screenshots) == 4, "Catalog UI omitted its four actual screenshot scenarios")
    for item in screenshots:
        verify_declared_file(index, item, base)
    for name, expected in data.get("moduleHashes", {}).items():
        index.file(name, expected)
    return {"channel": channel, "checks": CATALOG_CHECKS, **index.file(relative, base=base)}


def verify_generic_pdf(index, source_hash, pdf, base=None):
    from pypdf import PdfReader
    item = verify_declared_file(index, pdf, base)
    require(pdf["sourceHash"] == source_hash and isinstance(pdf["chartKind"], str) and pdf["chartKind"], "Generic PDF omitted its source or chart fixture")
    require((ROOT / item["path"]).read_bytes().startswith(b"%PDF-"), "Generic export is not an actual PDF")
    reader = PdfReader(ROOT / item["path"])
    diagnostic, pages = pdf["diagnostics"], pdf["pages"]
    require(pdf["pass"] is True and diagnostic["status"] == "complete" and len(reader.pages) == len(pages) == pdf["actualPages"] == diagnostic["pageCount"] > 0, "Generic PDF page count or export status differs")
    for name in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
        require(diagnostic[name] == [], "Generic PDF integrity failure: " + name)
    require(diagnostic["rowCount"] == diagnostic["renderedRowCount"], "Generic PDF changed report rows")
    require(all(check["exact"] or check.get("keepWithNext") and check["renderedCharacters"] == 0 for check in diagnostic["textChecks"]), "Generic PDF omitted report text")
    require(all(page["overflow"] == [] for page in pages), "Generic chart or report content exceeds its PDF page")
    for page in reader.pages:
        require(abs(float(page.mediabox.width) - 595.28) < 1 and abs(float(page.mediabox.height) - 841.89) < 1, "Generic PDF is not actual A4")
    fixture = pdf["fixture"]
    mode = fixture["mode"]
    require(mode in {"best", "mean"} and fixture["recordId"] == "synthetic-generic-v2210-" + mode, "Generic PDF substituted its independent record fixture")
    raw = json.loads(fixture["raw"])
    require([row["metrics"] for row in raw["g_pair"]] == [{"g_left": 20, "g_right": 50}, {"g_left": 40, "g_right": 30}, {"g_left": 30, "g_right": 40}], "Generic side-selection fixture changed its raw measurements")
    require([row["metrics"]["g_trial"] for row in raw["g_trials"]] == [10, "", 30, 20], "Generic trial fixture lost a real ordinal gap")
    require([row["metrics"] for row in raw["g_target"]] == [{"g_target_force": 30, "g_target_time": 7}, {"g_target_force": 40, "g_target_time": 8}, {"g_target_force": 20, "g_target_time": 6}], "Generic directional target fixture changed")
    expected_values = {"g_left": 40 if mode == "best" else 30, "g_right": 50 if mode == "best" else 40, "g_force": 24 if mode == "best" else 18, "g_zero": 0, "g_trial": 30 if mode == "best" else 20, "g_target_force": 40 if mode == "best" else 30, "g_target_time": 8 if mode == "best" else 7, "g_legacy_value": 25}
    require(all(abs(fixture["values"][key] - value) < 1e-8 for key, value in expected_values.items()), "Generic plotted values differ from independent raw-data expectations")
    require(fixture["narrative"] == "Synthetic manual narrative stays complete in generic chart export.", "Generic PDF substituted its manual narrative fixture")
    require(fixture["after"] == {key: fixture[key] for key in ["recordId", "raw", "narrative"]} and fixture["recordId"] and fixture["raw"] and fixture["narrative"], "Generic chart export changed raw measurements, record identity or manual narrative")
    require(fixture["narrative"] in "".join(page["text"] for page in pages), "Manual narrative is absent from the actual PDF")
    require(pdf["chartKind"] == "bars-trials-target" and fixture["expectedChartKinds"] == fixture["renderedChartKinds"] == ["bars", "target", "trials"], "Generic PDF lost or substituted selected chart types")
    charts = [chart for page in pages for chart in page["charts"]]
    require(charts and len(charts) == diagnostic["sourceChartCount"], "Generic PDF did not preserve actual selected chart artwork")
    for chart in charts:
        require(chart["rect"]["width"] > 0 and chart["rect"]["height"] > 0 and chart["naturalWidth"] > 0 and chart["naturalHeight"] > 0, "Generic PDF contains empty artwork")
    return item


def verify_generic_channel(index, source_hash, channel, base=None, archive_hash=None, executable_hash=None):
    require(GENERIC_CHECKS is not None, "2.21.0 generic plot check inventory is pending the final runner")
    relative = GENERIC_NATIVE if channel == "native" else GENERIC_PATTERN.format(channel=channel)
    data = index.read(relative, base)
    require(data["pass"] is True and data["synthetic"] is True and data["sourceUnchanged"] is True and source_identity(data) == source_hash and data["channel"] == channel, "Stale/failed generic plot receipt")
    require(data["checkCount"] == len(data["checks"]) == GENERIC_CHECKS and all(check["pass"] is True for check in data["checks"]) and len({check["name"] for check in data["checks"]}) == GENERIC_CHECKS, "Generic plot checks are missing, repeated or failed")
    require(not data["errors"] and not data["network"] and not data.get("failure") and not data.get("cleanupFailure"), "Generic plot run contains exceptions or remote requests")
    index.file(GENERIC_RUNNER, data["runnerSha256"])
    index.file("tests/helpers/pdf-browser.cjs", data["producers"]["pdfHelperSha256"])
    for name, expected in data.get("helperHashes", {}).items():
        index.file(name, expected)
    if channel == "native":
        require(data["packaged"] is True and data["platform"] == "win32" and data["artifactUnchanged"] is True and data["identity"] == data["finalIdentity"], "Generic plots were not tested in the unchanged packaged Windows program")
        require(data["versions"] == {"desktop": DESKTOP_VERSION, "web": VERSION, "build": VERSION}, "Generic native runtime has another version")
        require(data["isolation"]["isolatedProfile"] is True and data["isolation"]["temporaryProfileRemoved"] is True, "Generic native profile isolation or cleanup failed")
        require(re.fullmatch(r"[a-f0-9]{64}", data["executableSha256"]) and (executable_hash is None or data["executableSha256"] == executable_hash), "Generic charts used another executable")
        verify_native_identity(index, data["identity"], source_hash, Path(GENERIC_RUNNER).name, archive_hash)
    for item in data["artifacts"]:
        verify_declared_file(index, item, base)
    screenshot_paths = {item["path"] for item in data["artifacts"] if item["kind"] in {"generic-screenshot", "generic-focused-screenshot"}}
    screenshot_root = PurePosixPath(relative).parent
    expected_screenshots = {(screenshot_root / f"{channel}-{width}{suffix}.png").as_posix() for width in [1440, 1024, 390] for suffix in ["", "-g_pair", "-g_mixed", "-g_trials", "-g_target"]}
    require(len(screenshot_paths) == 15 and screenshot_paths == expected_screenshots, "Generic charts omitted a real width or focused screenshot")
    require(len(data["pdfs"]) == 2, "Generic charts omitted a required actual PDF export")
    require([pdf["fixture"]["mode"] for pdf in data["pdfs"]] == ["best", "mean"], "Generic PDFs omitted best or mean aggregation")
    for pdf in data["pdfs"]:
        verify_generic_pdf(index, source_hash, pdf, base)
    return data


def verify_generic_visual(index, source_hash, pdfs):
    from PIL import Image, ImageStat
    from pypdf import PdfReader
    visual = index.read(GENERIC_VISUAL)
    require(visual["pass"] is True and visual["synthetic"] is True and source_identity(visual) == source_hash, "Stale generic PDF visual review")
    require(len(visual["pdfs"]) == len(pdfs) and {item["path"] for item in visual["pdfs"]} == set(pdfs), "Generic visual review omitted or substituted PDFs")
    renderer, total = poppler_executable(), 0
    for reviewed in visual["pdfs"]:
        pdf = pdfs[reviewed["path"]]; item = index.item(reviewed)
        require(reviewed["pass"] is True and reviewed["sha256"] == pdf["sha256"], "Reviewed generic PDF differs from exported bytes")
        count = len(PdfReader(ROOT / item["path"]).pages)
        require(count == len(reviewed["pages"]) == len(pdf["pages"]) > 0 and [page["page"] for page in reviewed["pages"]] == list(range(1, count + 1)), "Generic visual review page list differs")
        with tempfile.TemporaryDirectory(prefix="motionbench-generic-pdf-2210-") as temporary:
            prefix = Path(temporary) / "page"
            subprocess.run([renderer, "-scale-to", "1500", "-png", str(ROOT / item["path"]), str(prefix)], check=True, capture_output=True)
            rendered = {int(path.stem.rsplit("-", 1)[1]): path for path in Path(temporary).glob("page-*.png")}
            require(sorted(rendered) == list(range(1, count + 1)), "Fresh generic PDF render omitted pages")
            for page in reviewed["pages"]:
                image = index.item(page)
                require(page["pass"] is True and page["reviewed"] is True, "Generic PDF page was not reviewed")
                with Image.open(ROOT / image["path"]) as saved, Image.open(rendered[page["page"]]) as actual:
                    saved, actual = saved.convert("RGB"), actual.convert("RGB")
                    require(list(saved.size) == page["size"] == list(actual.size) and saved.tobytes() == actual.tobytes(), "Generic reviewed pixels differ from actual PDF")
                    require(max(ImageStat.Stat(saved).stddev) > 5, "Generic PDF page rendered blank")
                total += 1
    require(total == visual["pagesReviewed"], "Generic PDF visual coverage omitted pages")
    return {"files": len(pdfs), "pages": total, "freshRenderPixelComparisons": total, "visualEvidence": index.file(GENERIC_VISUAL)}


def verify_generic_screenshot_visual(index, source_hash, screenshots):
    from PIL import Image
    visual = index.read(GENERIC_SCREENSHOT_VISUAL)
    require(visual["pass"] is True and visual["synthetic"] is True and source_identity(visual) == source_hash, "Stale or failed generic screenshot review")
    index.file(GENERIC_RUNNER, visual["runnerSha256"])
    require(len(screenshots) == len(visual["artifacts"]) == 45 and {item["path"] for item in visual["artifacts"]} == set(screenshots), "Generic screenshot review omitted or substituted actual screenshots")
    for reviewed in visual["artifacts"]:
        require(reviewed["pass"] is True and reviewed["reviewed"] is True and isinstance(reviewed["reviewMethod"], str) and reviewed["reviewMethod"], "Generic screenshot was not visually reviewed")
        actual = screenshots[reviewed["path"]]
        require(all(reviewed[key] == actual[key] for key in ["path", "sha256", "bytes", "kind"]), "Reviewed generic screenshot differs from the real captured bytes")
        item = verify_declared_file(index, reviewed)
        with Image.open(ROOT / item["path"]) as image:
            require(list(image.size) == reviewed["size"] and image.width > 0 and image.height > 0, "Generic screenshot dimensions differ from reviewed pixels")
    return {"files": 45, "visualEvidence": index.file(GENERIC_SCREENSHOT_VISUAL)}


def verify_uninstall_diagnostic(index, source_hash, ci, uninstall, installer, base):
    relative = "output/desktop-package/uninstall-diagnostic.json"
    require(any(item["path"] == relative and item["kind"] == "uninstall-diagnostic" for item in ci["artifacts"]), "CI omitted the uninstall diagnostic identity")
    data = index.read(relative, base)
    require(data["synthetic"] is True and data["sourceHtmlSha256"] == source_hash and data["installerSha256"] == installer["sha256"], "Uninstall diagnostics belong to another program")
    require(data["outcomeAssertionsPassed"] is True and data["arguments"] == "/S" and data["launchProcess"]["exitCode"] == 0, "Uninstall lifecycle or outcome assertions failed")
    require(data["monitorReadyBeforeLaunch"] is True and data["monitorState"] == "Completed" and data["monitorErrors"] == [] and not data.get("monitorCleanupTimedOut") and not data.get("failure"), "Uninstall diagnostic monitoring failed")
    require(data["before"]["appExeExists"] is True and data["before"]["originalUninstallerExists"] is True and data["before"]["hkcuInstallLocation"] == data["installDirectory"], "Uninstall did not start with its owned installed program")
    require(data["after"] == {"appExeExists": False, "originalUninstallerExists": False, "hkcuInstallLocation": None, "processes": []}, "Uninstall left installed files, registry location or an owned process")
    require(data["canaryExistsAfter"] is True and data["canarySha256Before"] == data["canarySha256After"] == uninstall["canarySha256Before"] == uninstall["canarySha256After"], "Uninstall diagnostics and preserved-data receipt disagree")
    require(data["polls"] >= len(data["transitions"]) > 0, "Uninstall lacks actual sampled state transitions")
    return index.file(relative, base=base)


def verify_ci(index, relative, source_hash, required, artifact_root="", local_stage=False):
    require(not Path(artifact_root).is_absolute(), "CI artifact root must be repository-relative")
    baseline = index.read(BASELINE_FIXTURE)
    require(baseline["schema"] == 1 and baseline["version"] == "2.19.1-desktop.1" and baseline["commit"] == "03ecd3b9f524d94199521d6b4dbdf65deb046704" and baseline["releaseTag"] == "rollback-v2.19.1-desktop.1-before-2.20.0-20261013", "The fixed old desktop baseline identity changed")
    require(baseline["archiveUrl"] == BASELINE_ARCHIVE_URL and baseline["archiveSha256"] == BASELINE_ARCHIVE_SHA256 and baseline["archiveSize"] == 119779936, "The permanent old desktop ZIP differs from the verified original artifact")
    baseline_evidence = {**baseline, "fixture": index.file(BASELINE_FIXTURE)}
    root = (ROOT / artifact_root).resolve()
    require(root.is_relative_to(ROOT), "CI artifact root escaped workspace")
    if local_stage or not (root / relative).is_file():
        require(not required, "Real CI installer and upgrade evidence is pending: " + relative)
        return {"status": "pending", "passed": False, "evidencePath": relative, "baseline": baseline_evidence, "requiredChecks": ["assisted directory selection", "old-to-new installed upgrade", "installed application", "portable wrapper", "uninstall preserves default data", "native management 12 checks", "published update asset checksums"]}
    ci = index.read(relative, artifact_root)
    require(ci.get("passed", ci.get("pass")) and source_identity(ci) == source_hash and ci["version"] == DESKTOP_VERSION and ci["webVersion"] == VERSION, "CI aggregate failed or refers to another candidate")
    require(re.fullmatch(r"[a-f0-9]{40}", ci["commit"]) and str(ci["run"]).startswith("https://github.com/ZekeNiu/MotionBench/actions/runs/"), "Invalid CI provenance")
    require(ci["synthetic"] is True and len({item["path"] for item in ci["artifacts"]}) == len(ci["artifacts"]), "CI artifact list has duplicate paths or real data")
    for item in ci["artifacts"]:
        index.item(item, artifact_root)
    producers = ci["producerScripts"]
    if isinstance(producers, dict):
        producers = [{"repoPath": name, "sha256": sha} for name, sha in producers.items()]
    names = set()
    for item in producers:
        index.file(item["repoPath"], item["sha256"]); names.add(item["repoPath"])
    require(len(producers) == 15 and {".github/workflows/desktop-windows.yml", "scripts/check-desktop-package.cjs", "tests/desktop-installer-wizard-ci.ps1", "tests/desktop-installed-upgrade-v2210-ci.ps1", BASELINE_FIXTURE, "tests/desktop-upgrade-library-v2210-ci.cjs", "tests/helpers/desktop-installer-native.cs", "tests/helpers/desktop-artifact-identity.cjs", "tests/portable-wrapper-tests.cjs", "tests/desktop-smoke.cjs", "tests/desktop-v2210-management-tests.cjs", "tests/pdf-multiaxis-v221-browser-tests.cjs", "tests/desktop-v221-pdf-tests.cjs", CATALOG_RUNNER, GENERIC_RUNNER} == names, "CI aggregate omitted or duplicated producer identities")
    require(set(ci["hostSourceHashes"]) == {p.relative_to(ROOT).as_posix() for p in (ROOT / "desktop").glob("*.cjs")}, "CI aggregate omitted host modules")
    for name, expected in ci["hostSourceHashes"].items():
        index.file(name, expected)
    artifact_paths = {item["path"] for item in ci["artifacts"]}
    asset_names = {f"MotionBench-{DESKTOP_VERSION}-Setup-x64.exe", f"MotionBench-{DESKTOP_VERSION}-Portable-x64.exe", f"MotionBench-{DESKTOP_VERSION}-Setup-x64.exe.blockmap", "desktop.yml"}
    require({Path(item["path"]).name for item in ci["artifacts"] if item["kind"] == "update-asset"} == asset_names, "CI update asset allowlist differs")
    receipts = {key: index.read(path, artifact_root) for key, path in CI_RESULTS.items()}
    require(set(CI_RESULTS.values()) <= artifact_paths, "CI aggregate omitted real installer receipts")
    wizard, upgrade = receipts["wizard"], receipts["upgrade"]
    require(wizard["passed"] and wizard["pathEditorPresent"] and wizard["browsePresent"] and wizard["cancelledBeforeInstall"] and wizard["privateDesktopClosed"], "Real assisted directory page did not pass")
    require(any(ord(char) > 127 for char in wizard["chosenDisplayedPath"]) and " " in wizard["chosenDisplayedPath"], "Directory wizard omitted Chinese/spaced path")
    require(any(item["sha256"] == wizard["screenshotSha256"] and item["path"].endswith(".bmp") for item in ci["artifacts"]), "Missing actual directory-page capture")
    index.file("tests/desktop-installer-wizard-ci.ps1", wizard["scriptSha256"]); index.file("tests/helpers/desktop-installer-native.cs", wizard["helperSha256"])
    require(upgrade["passed"] and upgrade["oldVersion"] == "2.19.1-desktop.1" and upgrade["newVersion"] == DESKTOP_VERSION and upgrade["originalInstallLocationPreserved"] and upgrade["rawLibraryAndCredentialsPreserved"] and upgrade["ownedInstallationRemoved"], "Actual old-to-new upgrade did not pass")
    require(upgrade["previousCommit"] == "03ecd3b9f524d94199521d6b4dbdf65deb046704", "Cross-version upgrade used another baseline")
    require(upgrade["previousArchiveVerified"] and upgrade["previousArchiveUrl"] == baseline["archiveUrl"] and upgrade["previousArchiveSha256"] == baseline["archiveSha256"] and upgrade["previousArchiveSize"] == baseline["archiveSize"] and upgrade["baselineFixtureSha256"] == baseline_evidence["fixture"]["sha256"], "Upgrade did not verify the permanent old-version ZIP")
    index.file("tests/desktop-installed-upgrade-v2210-ci.ps1", upgrade["scriptSha256"])
    seed_result = index.read("output/tests/v2210-desktop/installed-upgrade/seed-results.json", artifact_root)
    verified = index.read("output/tests/v2210-desktop/installed-upgrade/verify-results.json", artifact_root)
    require({"output/tests/v2210-desktop/installed-upgrade/seed-results.json", "output/tests/v2210-desktop/installed-upgrade/verify-results.json"} <= artifact_paths, "CI aggregate omitted upgrade library receipts")
    require(seed_result["passed"] and seed_result["phase"] == "seed" and seed_result["version"] == "2.19.1-desktop.1" and not seed_result.get("error"), "Previous app did not produce the real upgrade seed")
    require(verified["passed"] and verified["phase"] == "verify" and verified["version"] == DESKTOP_VERSION and not verified.get("error") and verified["runtimeHtmlSha256"] == source_hash and verified["rawMeasurementsAndIdsPreserved"] and verified["dpapiCipherAndRevisionPreserved"], "Upgraded library or encrypted settings did not survive")
    for receipt in [seed_result, verified]:
        index.file("tests/desktop-upgrade-library-v2210-ci.cjs", receipt["testScriptSha256"])
    require(seed_result["seedSha256"] == verified["seedSha256"], "Upgrade used a different seed")
    seed_file = "output/tests/v2210-desktop/installed-upgrade/synthetic-seed.json"
    index.file(seed_file, verified["seedSha256"], artifact_root)
    seed = index.read(seed_file, artifact_root)
    require(seed["synthetic"] and seed["oldArchiveSha256"] == seed_result["archiveSha256"] and seed["oldRuntimeHtmlSha256"] == seed_result["runtimeHtmlSha256"], "Upgrade seed refers to another old runtime")
    require(receipts["installed"]["pass"] and receipts["portable"]["pass"], "Installed or portable smoke failed")
    for name in ["installed", "portable"]:
        require(not receipts[name].get("errors") and not receipts[name].get("failure"), "CI application receipt contains failures")
    installed = receipts["installed"]
    require(len(installed["checks"]) == 16 and installed["artifactUnchanged"] and installed["identity"] == installed["finalIdentity"] and not installed.get("network"), "Installed CI smoke is incomplete or changed its runtime")
    verify_smoke_lifecycle(installed)
    identity = installed["identity"]
    verify_native_identity(index, identity, source_hash, "desktop-smoke.cjs", verified["archiveSha256"])
    require(identity["sourceHtmlSha256"] == identity["runtimeHtmlSha256"] == source_hash and identity["runtimeMatchesSourceHtml"] and identity["archiveSha256"] == verified["archiveSha256"], "Installed CI runtime differs from final HTML or upgraded archive")
    index.file("tests/desktop-smoke.cjs", identity["testScriptSha256"])
    index.file("tests/helpers/desktop-artifact-identity.cjs", identity["identityHelperSha256"])
    for name, expected in identity["sourceHashes"].items():
        index.file(name, expected)
    for name, expected in identity["runtimeHashes"].items():
        if name != "package.json":
            index.file(name, expected)
    for item in installed["artifacts"]:
        index.item(item, Path(artifact_root) / Path(CI_RESULTS["installed"]).parent)
    management = receipts["management"]
    require(management["cleanup"]["temporaryProfileRemoved"] is True and management["cleanup"]["sessions"] == [] and management["cleanup"]["errors"] == [], "CI management session/profile cleanup failed")
    require(management["pass"] is True and management["synthetic"] is True and management["packaged"] is True and management["platform"] == "win32" and len(management["checks"]) == 12 and not management["errors"] and not management["network"] and not management.get("failure"), "CI native management did not pass all 12 checks")
    require(management["artifactUnchanged"] is True and management["identity"] == management["finalIdentity"], "CI native management runtime changed")
    verify_native_identity(index, management["identity"], source_hash, "desktop-v2210-management-tests.cjs", identity["archiveSha256"])
    require(management["versions"]["desktop"] == DESKTOP_VERSION and management["versions"]["web"] == VERSION and management["blockedNativeClose"]["windowAlive"] is True, "CI management version/exit guard differs")
    require([session["label"] for session in management["sessions"]] == ["initial", "reopened"] and all(session["isolatedUserData"] for session in management["sessions"]) and management["sessions"][0]["nativePid"] != management["sessions"][1]["nativePid"], "CI management did not restart in a separate isolated process")
    require(len(management["artifacts"]) == 12, "CI management screenshots are incomplete")
    for item in management["artifacts"]:
        index.item(item, Path(artifact_root) / Path(CI_RESULTS["management"]).parent)
    uninstall = receipts["uninstall"]
    require(uninstall["preserved"] and uninstall["applicationRemoved"] and uninstall["uninstallerRemoved"] and uninstall["canarySha256Before"] == uninstall["canarySha256After"], "Uninstall failed to preserve default data")
    installer = [item for item in ci["artifacts"] if item["path"].endswith("-Setup-x64.exe")]
    require(len(installer) == 1 and installer[0]["sha256"] == wizard["installerSha256"] == upgrade["newInstallerSha256"], "Installer receipts are not bound to the delivered Setup")
    def asset(suffix):
        matches = [item for item in ci["artifacts"] if item["path"].endswith(suffix)]
        require(len(matches) == 1, "Missing or duplicate CI asset: " + suffix)
        return matches[0]
    verify_uninstall_diagnostic(index, source_hash, ci, uninstall, installer[0], artifact_root)
    portable, metadata = asset("-Portable-x64.exe"), asset("desktop.yml")
    portable_receipt = receipts["portable"]
    require(portable_receipt["sourceHtmlSha256"] == source_hash and portable_receipt["sourceUnchanged"] and portable_receipt["version"] == DESKTOP_VERSION and portable_receipt["webVersion"] == VERSION and portable_receipt["executableSha256"] == portable["sha256"] and len(portable_receipt["checks"]) == 3 and not portable_receipt.get("cleanupFailure"), "Portable receipt belongs to another runtime or executable")
    index.file("tests/portable-wrapper-tests.cjs", portable_receipt["testScriptSha256"])
    index.file("output/desktop-smoke/portable/portable-wrapper-reopened.png", base=artifact_root)
    asset("-Setup-x64.exe.blockmap")
    provenance = index.read(asset("build-provenance.json")["path"], artifact_root)
    require(provenance["commit"] == ci["commit"] and provenance["run"] == ci["run"] and provenance["version"] == DESKTOP_VERSION and provenance["webVersion"] == VERSION, "CI download provenance differs from installer evidence")
    require(provenance["previousArchiveUrl"] == baseline["archiveUrl"] and provenance["previousArchiveSha256"] == baseline["archiveSha256"] and provenance["previousArchiveSize"] == baseline["archiveSize"] and provenance["previousVersion"] == baseline["version"] and provenance["previousInstallerSha256"] == upgrade["oldInstallerSha256"], "CI provenance names another old-version archive or installer")
    for key in ["packagedSmoke", "installedSmoke", "portableWrapperSmoke", "syntheticDefaultDataUninstallCheck", "inPlaceReinstallPathCheck", "guidedDirectoryWizardCheck", "previousVersionUpgradeCheck"]:
        require(provenance[key] == "passed", "CI provenance records a pending/failed check: " + key)
    sums = (root / asset("SHA256SUMS.txt")["path"]).read_text(encoding="utf-8-sig")
    declared = {match.group(2).strip(): match.group(1).lower() for match in re.finditer(r"^([a-fA-F0-9]{64})\s+(.+)$", sums, re.M)}
    require(set(declared) == set(ci["assetSha256"]) == set(provenance["assetSha256"]) == asset_names and len(re.findall(r"^([a-fA-F0-9]{64})\s+(.+)$", sums, re.M)) == len(asset_names), "CI checksum/provenance asset inventory differs")
    for item in [item for item in ci["artifacts"] if item["kind"] == "update-asset"]:
        require(declared.get(Path(item["path"]).name) == item["sha256"], "CI asset checksum declaration differs")
        require(provenance["assetSha256"][Path(item["path"]).name] == ci["assetSha256"][Path(item["path"]).name] == item["sha256"], "CI asset provenance differs from actual download")
    yaml_script = "const fs=require('fs'),yaml=require('js-yaml');console.log(JSON.stringify(yaml.load(fs.readFileSync(process.argv[1],'utf8'))));"
    update = json.loads(subprocess.check_output(["node", "-e", yaml_script, str(root / metadata["path"])], cwd=ROOT, text=True))
    require(update["version"] == DESKTOP_VERSION and len(update["files"]) == 1, "Wrong dedicated desktop update metadata")
    listed = update["files"][0]; setup_path = root / installer[0]["path"]
    require(listed["url"] == update["path"] == setup_path.name and listed["size"] == setup_path.stat().st_size, "Update metadata names another installer")
    sha512 = hashlib.sha512()
    with setup_path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha512.update(block)
    require(listed["sha512"] == update["sha512"] == base64.b64encode(sha512.digest()).decode("ascii"), "Update metadata SHA512 differs from actual CI installer")
    verify_ci_test_receipts(index, source_hash, artifact_root, identity["archiveSha256"])
    verify_pagination_native(index, source_hash, identity["archiveSha256"], artifact_root, management["executableSha256"])
    for channel in ["chrome", "msedge"]:
        verify_catalog_browser(index, source_hash, channel, artifact_root)
        verify_generic_channel(index, source_hash, channel, artifact_root)
    require(GENERIC_NATIVE in artifact_paths, "CI aggregate omitted actual packaged generic charts")
    verify_generic_channel(index, source_hash, "native", artifact_root, identity["archiveSha256"], management["executableSha256"])
    require(CATALOG_NATIVE in artifact_paths, "CI aggregate omitted actual packaged preset/chart management")
    verify_catalog_browser(index, source_hash, "native", artifact_root, identity["archiveSha256"], management["executableSha256"])
    committed = {}
    for name, item in sorted(index.files.items()):
        if name in EVIDENCE_TOOLS:
            continue  # These offline evidence tools are hashed dependencies, not CI producers.
        if name == "MotionBench.html" or name.startswith(("src/", "desktop/", "tests/", "vendor/", "scripts/")) or name in {"package.json", "package-lock.json", "electron-builder.yml", "body-map-front.png", ".github/workflows/desktop-windows.yml", STANDARDS_DOC}:
            actual = hashlib.sha256(subprocess.check_output(["git", "show", ci["commit"] + ":" + name], cwd=ROOT)).hexdigest()
            require(actual == item["sha256"], "CI commit contains another source/test/helper: " + name)
            committed[name] = actual
    return {"status": "passed", "passed": True, "commit": ci["commit"], "run": ci["run"], "artifactRoot": artifact_root, "evidencePath": relative, "evidence": index.file(relative, base=artifact_root), "baseline": baseline_evidence, "checks": {"installerWizard": True, "installedUpgrade": True, "installedSmoke": 16, "portableWrapper": 3, "nativeManagement": 12, "nativePdf": 4, "browserPdf": 16, "catalogBrowser": CATALOG_CHECKS * 2, "genericBrowser": GENERIC_CHECKS * 2, "genericNative": GENERIC_CHECKS, "catalogNative": CATALOG_CHECKS, "uninstallPreservesData": True, "updateAssetSha512": True}, "commitBoundFiles": committed, "evidenceVerificationTools": {name: index.file(name) for name in sorted(EVIDENCE_TOOLS)}, "runtimeIdentityMatchesLocalSource": True, "installer": index.item(installer[0], artifact_root), "portable": index.item(portable, artifact_root)}


def verify_ci_test_receipts(index, source_hash, base, archive_hash):
    unit = index.read(EVIDENCE["unit"], base)
    registered = re.findall(r'^\s*"([^"\n]+\.cjs)",\s*$', (ROOT / "tests/run-unit-tests.cjs").read_text(encoding="utf-8"), re.M)
    require(unit["sourceHash"] == source_hash and unit["sourceUnchanged"] is True and [suite["name"] for suite in unit["suites"]] == registered and len(registered) == EXPECTED_UNIT_SUITES and sum(suite["checksPassed"] for suite in unit["suites"]) == EXPECTED_UNIT_CHECKS, "CI model suite inventory differs")
    index.file("tests/run-unit-tests.cjs", unit["runnerSha256"])
    require(set(unit["modules"]) == {path.name for path in (ROOT / "src").glob("*.js")}, "CI unit evidence omitted modules")
    for name, expected in unit["modules"].items():
        index.file("src/" + name, expected)
    for suite in unit["suites"]:
        require(suite["exitCode"] == 0 and suite["sourceUnchanged"] is True and suite["checksPassed"] > 0, "CI model suite failed")
        index.file("tests/" + suite["name"], suite["sha256"])
        reported = re.search(r"(\d+) [^\n]*checks passed", suite["stdout"]) or re.search(r"PASS (\d+) athlete context (?:model|Excel) scenarios", suite["stdout"])
        require(reported and int(reported.group(1)) == suite["checksPassed"], "CI suite count differs from runner output")
    for name, pattern, runner, count in BROWSER_SPECS:
        if name == "report":
            continue  # Actual four-PDF exports are supplied by local browsers.
        for channel in ["chrome", "msedge"]:
            data = index.read(pattern.format(channel=channel), base)
            require(data["pass"] is True and data["sourceUnchanged"] is True and source_identity(data) == source_hash and data["channel"] == channel and len(data["checks"]) == count and not data.get("errors") and not data.get("network") and not data.get("error") and not data.get("failure"), "CI browser receipt failed or changed")
            index.file("tests/" + runner, data["runnerSha256"])
            for item in data.get("artifacts", []) + data.get("screenshots", []):
                index.item(item, base)
            for filename, expected in data.get("moduleHashes", {}).items():
                index.file(filename, expected)
            if name == "management":
                for width in [1440, 1024, 390]:
                    for view in ["catalog", "projects", "aggregations", "preview"]:
                        index.file(f"output/playwright/management-v220/{channel}-{view}-{width}.png", base=base)
    for channel in ["chrome", "msedge"]:
        verify_pagination_browser(index, source_hash, channel, base)
    desktop = index.read(EVIDENCE["desktopUnit"], base)
    require(desktop["passed"] is True and len(desktop["checks"]) == 23, "CI update unit coverage differs")
    index.file("tests/desktop-update-tests.cjs", desktop["testScriptSha256"])
    require(set(desktop["sourceHashes"]) == {"desktop/preferences.cjs", "desktop/update-service.cjs", "desktop/update-bridge.cjs", "desktop/windows-updater.cjs", "desktop/preload.cjs"}, "CI update unit source binding differs")
    for name, expected in desktop["sourceHashes"].items():
        index.file(name, expected)
    package = index.read(EVIDENCE["package"], base)
    require(package["version"] == DESKTOP_VERSION and package["webVersion"] == VERSION and package["directoryOnly"] is False and package["updaterConfigurationPresent"] is True and package["archiveSha256"] == archive_hash, "CI production package differs from tested archive")
    for relative, runner, count in [("output/desktop-smoke/packaged/results.json", "desktop-smoke.cjs", 16), ("output/tests/v220-desktop/packaged-updates/native-update-results.json", "desktop-updates-native-tests.cjs", 5)]:
        data = index.read(relative, base)
        require(data.get("pass", data.get("passed")) is True and data["synthetic"] is True and data["packaged"] is True and len(data["checks"]) == count and data["artifactUnchanged"] is True and data["identity"] == data["finalIdentity"] and not data.get("errors") and not data.get("network") and not data.get("failure"), "CI packaged smoke/update failed")
        if runner == "desktop-smoke.cjs":
            verify_smoke_lifecycle(data)
        verify_native_identity(index, data["identity"], source_hash, runner, archive_hash)
        for item in data.get("artifacts", []):
            index.item(item, Path(base) / Path(relative).parent)


def scientific_protection(index):
    baseline = "416897bd5022fbe3b7205c22b5d82f9078406b07"
    text = (ROOT / "tests/evaluation-v220-model-tests.cjs").read_text(encoding="utf-8")
    require('baselineRevision = "' + baseline + '"' in text, "Historical scoring test changed its independent old revision")
    modules = ["calc", "scoring", "fvp", "sprint-fvp", "sprint-elasticity", "cpet-reference", "iso-reference", "definitions", "tests", "model", "evaluation", "interventions"]
    historical = {}
    for name in modules:
        path = "src/ringside-" + name + ".js"
        historical[path] = hashlib.sha256(subprocess.check_output(["git", "show", baseline + ":" + path], cwd=ROOT)).hexdigest()
    return {"scoringBaselineRevision": baseline, "scoringBaselineModules": historical, "numericalFixture": index.file("tests/fixtures/capability-direction-values-v2175.json"), "approvedJudgmentFixture": index.file("tests/fixtures/capability-direction-values-v2191.json"), "legacyPrimaryFingerprintCompatibility": True, "referenceMeanBehaviorUnchanged": True}


def acceptance_markdown(data):
    confidence = "高（交付所用真实检查证据均通过）" if data["ciChecksPass"] else "高（已核验的本机检查）；真实安装升级尚未核验"
    ci_result = "真实目录选择、旧版升级、安装版 16 项、便携 3 项、原生管理 12 项、卸载保留资料与更新资产通过" if data["ciChecksPass"] else "待验收：真实目录选择、旧版升级、安装版、便携程序与卸载保留资料"
    ci_native = sum(item["checks"] for item in data["desktop"]["native"] if item.get("origin") == "ci")
    native_result = f"{data['desktop']['nativeChecks']} 项通过" + (f"（本机 {data['desktop']['nativeChecks'] - ci_native} 项；正式 Windows CI {ci_native} 项）" if ci_native else "")
    smoke_argument = f" --native-smoke-evidence {data['desktop']['nativeSmokeEvidence']['source']}" if ci_native else ""
    local_limit = "\n本机原生 smoke 的失败回执按原字节保留；该组 16 项采用正式 CI 中相同源码、程序包和测试脚本的真实运行结果。具体失败信息与两种证据来源见 JSON 清单，未将本机失败计为通过。\n" if ci_native else ""
    return f"""# MotionBench 2.21.0 验收记录

置信度：{confidence}。

HTML 版本 **2.21.0**；Windows 版本 **2.21.0-desktop.1**。成品 SHA256：

`{data['artifact']['sha256']}`

| 检查 | 结果 |
|---|---:|
| 模型与数据合同 | {data['unit']['suites']} 组，{data['unit']['checks']} 项通过 |
| Chrome / Edge 管理、报告、资料保存与设置 | {sum(x['checks'] for x in data['browsers'])} 项通过 |
| 报告 PDF | {data['pdf']['files']} 份、{data['pdf']['pages']} 页；已目检图片与实际 PDF 重新渲染结果逐页一致 |
| 多能力 PDF 回归 | {data['pdfRegression']['files']} 份、{data['pdfRegression']['pages']} 页；浏览器 16 项、实际打包程序 4 项通过，全部页面重新渲染核对 |
| 常见预设与图表管理 | 浏览器 {sum(item["checks"] for item in data["catalog"])} 项、实际原生程序 {data["catalogNative"]["checks"]} 项通过 |
| 通用图表与 PDF | {sum(item["checks"] for item in data["genericCharts"]["runs"])} 项，{data["genericCharts"]["visual"]["files"]} 份实际 PDF、{data["genericCharts"]["visual"]["pages"]} 页重新渲染核对 |
| 桌面更新单元 | {data['desktop']['unitChecks']} 项通过 |
| 正式程序录入、保存重开、导出、更新与管理 | {native_result} |
| Windows CI | {ci_result} |

新增常见测试预设、协议与人群明确的评价参考，以及可保存选择的通用报告图表。验收覆盖真实录入、管理保存、图表选择、独立浏览器和实际打包程序导出，并继续核对原始测量、记录 ID、手写解读、参考均值与历史科学数值合同。
{local_limit}

完整文件依赖和哈希见 [JSON 清单](acceptance-2.21.0.json)。所有检查使用合成资料。严格核验入口为 `python scripts/verify_delivery.py --require-ci{smoke_argument}`。只有显式 `--freeze` / `--record` 更新验收文件；`--local-stage` 仅验证本机阶段，不代表发布验收通过。
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--freeze", "--record", dest="freeze", action="store_true", help="Record verified acceptance JSON and Markdown")
    parser.add_argument("--require-ci", action="store_true")
    parser.add_argument("--ci-evidence", help="CI receipt path; defaults to the frozen receipt or output/tests/v2210-desktop/ci-results.json")
    parser.add_argument("--ci-artifact-root", help="Repository-relative extracted CI root; defaults to the frozen root")
    parser.add_argument("--native-smoke-evidence", help="Explicitly use only the real packaged smoke receipt below --ci-artifact-root; requires --require-ci")
    parser.add_argument("--local-stage", action="store_true", help="Verify local evidence without requiring or consuming pending CI evidence")
    args = parser.parse_args()
    require(not (args.local_stage and args.require_ci), "--local-stage and --require-ci are mutually exclusive")
    saved = json.loads(DEST.read_text(encoding="utf-8")) if DEST.exists() else {}
    frozen_ci = saved.get("ci", {}) if saved.get("recordedAt") else {}
    ci_relative = args.ci_evidence if args.ci_evidence is not None else frozen_ci.get("evidencePath", "output/tests/v2210-desktop/ci-results.json")
    ci_root = args.ci_artifact_root if args.ci_artifact_root is not None else frozen_ci.get("artifactRoot", "")
    smoke_selection = native_smoke_selection(args.native_smoke_evidence, args.require_ci, args.local_stage, ci_root)
    index = EvidenceIndex()
    artifact, sources = verify_source(index)
    unit = verify_units(index, artifact["sha256"])
    browsers, downloads = verify_browsers(index, artifact["sha256"])
    pdf = verify_pdf(index, artifact["sha256"], downloads)
    desktop = verify_desktop(index, artifact["sha256"], smoke_selection)
    desktop["nativeSmokeEvidence"] = {"origin": smoke_selection["origin"], "source": index.file(smoke_selection["relative"], base=smoke_selection["base"])["path"]}
    if smoke_selection["origin"] == "ci":
        local_smoke = index.read(EVIDENCE["nativeSmoke"])
        verify_native_identity(index, local_smoke["identity"], artifact["sha256"], "desktop-smoke.cjs", desktop["archive"]["sha256"])
        desktop["nativeSmokeEvidence"]["localEvidence"] = {**index.file(EVIDENCE["nativeSmoke"]), "pass": local_smoke["pass"], "checksCompleted": len(local_smoke["checks"]), "failure": local_smoke.get("failure")}
    pagination_pdfs, pagination_browsers, baseline_failures = {}, [], []
    for channel in ["chrome", "msedge"]:
        pagination = verify_pagination_browser(index, artifact["sha256"], channel)
        pagination_browsers.append({"channel": channel, "checks": 8, **index.file(f"output/implementation-2.21.0/pdf/{channel}.json")})
        baseline_failures.append(verify_pagination_baseline(index, channel))
        for exported in pagination["pdfs"]:
            require(exported["file"] not in pagination_pdfs, "Duplicate pagination PDF")
            pagination_pdfs[exported["file"]] = exported
    native_pdf = verify_pagination_native(index, artifact["sha256"], desktop["archive"]["sha256"], executable_hash=desktop["executable"]["sha256"])
    for exported in native_pdf["pdfs"]:
        require(exported["file"] not in pagination_pdfs, "Duplicate native pagination PDF")
        pagination_pdfs[exported["file"]] = exported
    pdf_regression = {**verify_pagination_visual(index, artifact["sha256"], pagination_pdfs), "browsers": pagination_browsers, "native": {"checks": 4, **index.file(EVIDENCE["nativePdf"])}, "publicBaselineReproductions": baseline_failures}
    desktop["nativeChecks"] += 4
    desktop["native"].append({"name": "nativePdf", "checks": 4, "origin": "local", **index.file(EVIDENCE["nativePdf"])})
    catalog = [verify_catalog_browser(index, artifact["sha256"], channel) for channel in ["chrome", "msedge"]]
    catalog_native = verify_catalog_browser(index, artifact["sha256"], "native", archive_hash=desktop["archive"]["sha256"], executable_hash=desktop["executable"]["sha256"])
    desktop["native"].append({"name": "nativeCatalog", "origin": "local", **catalog_native})
    generic_pdfs, generic_screenshots, generic_runs = {}, {}, []
    for channel in ["chrome", "msedge", "native"]:
        generic = verify_generic_channel(index, artifact["sha256"], channel, archive_hash=desktop["archive"]["sha256"] if channel == "native" else None, executable_hash=desktop["executable"]["sha256"] if channel == "native" else None)
        relative = GENERIC_NATIVE if channel == "native" else GENERIC_PATTERN.format(channel=channel)
        generic_runs.append({"channel": channel, "checks": GENERIC_CHECKS, **index.file(relative)})
        if channel == "native":
            desktop["native"].append({"name": "nativeGeneric", "checks": GENERIC_CHECKS, "origin": "local", **index.file(relative)})
        for exported in generic["pdfs"]:
            require(exported["path"] not in generic_pdfs, "Generic PDFs have repeated evidence paths")
            generic_pdfs[exported["path"]] = exported
        for item in generic["artifacts"]:
            if item["kind"] in {"generic-screenshot", "generic-focused-screenshot"}:
                require(item["path"] not in generic_screenshots, "Generic screenshots have repeated evidence paths")
                generic_screenshots[item["path"]] = item
    generic_charts = {"runs": generic_runs, "visual": verify_generic_visual(index, artifact["sha256"], generic_pdfs), "screenshots": verify_generic_screenshot_visual(index, artifact["sha256"], generic_screenshots)}
    desktop["nativeChecks"] += GENERIC_CHECKS + CATALOG_CHECKS
    scientific = scientific_protection(index)
    index.file(STANDARDS_DOC)
    index.file("scripts/verify_v2210.py"); index.file("scripts/verify_delivery.py"); index.file("scripts/package_v2210_evidence.py")
    ci = verify_ci(index, ci_relative, artifact["sha256"], args.require_ci, ci_root, args.local_stage)
    if smoke_selection["origin"] == "ci":
        require(ci["passed"] is True, "CI native smoke cannot replace local evidence before all real CI checks pass")
        desktop["nativeSmokeEvidence"].update({"commit": ci["commit"], "run": ci["run"]})
    for item in list(index.files.values()):
        index.file(item["path"], item["sha256"])
    data = {"version": VERSION, "desktopVersion": DESKTOP_VERSION, "status": "passed" if ci["passed"] else "local-passed-ci-pending", "pass": True, "passScope": "complete" if ci["passed"] else "localChecks", "localChecksPass": True, "ciChecksPass": ci["passed"], "implementationComplete": ci["passed"], "artifact": artifact, "reproducibleBuild": True, "emptyEmbeddedData": True, "sourceHashes": sources, "unit": unit, "scientificProtection": scientific, "catalog": catalog, "catalogNative": catalog_native, "genericCharts": generic_charts, "browsers": browsers, "pdf": pdf, "pdfRegression": pdf_regression, "desktop": desktop, "ci": ci, "dependencies": [index.files[key] for key in sorted(index.files)]}
    data["localChecksPassScope"] = "allLocalGroupsExceptNativeSmoke" if smoke_selection["origin"] == "ci" else "allLocalGroups"
    data["localNativeSmokePass"] = desktop["nativeSmokeEvidence"]["localEvidence"]["pass"] if smoke_selection["origin"] == "ci" else True
    data["coverage"] = {"browserChecks": sum(item["checks"] for item in browsers) + sum(item["checks"] for item in catalog) + sum(item["checks"] for item in pdf_regression["browsers"]) + sum(item["checks"] for item in generic_runs if item["channel"] != "native"), "nativeChecks": desktop["nativeChecks"], "pdfFiles": pdf["files"] + pdf_regression["files"] + generic_charts["visual"]["files"], "pdfPages": pdf["pages"] + pdf_regression["pages"] + generic_charts["visual"]["pages"]}
    require(data["coverage"]["browserChecks"] == 176 and data["coverage"]["nativeChecks"] == 59 and data["coverage"]["pdfFiles"] == 20, "Final browser/native/PDF fixture coverage differs")
    if args.freeze:
        data["recordedAt"] = datetime.now(timezone.utc).isoformat()
        DEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (ROOT / "docs/acceptance-2.21.0.md").write_text(acceptance_markdown(data), encoding="utf-8")
    elif DEST.exists() and not args.local_stage:
        if saved.pop("recordedAt", None):
            require(saved == data, "Acceptance snapshot differs; review current evidence, then explicitly --freeze")
        else:
            require(saved.get("status") == "verification-pending" and saved.get("pass") is False, "Acceptance snapshot is missing its freeze timestamp")
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"version": VERSION, "sha256": artifact["sha256"], "modelSuites": unit["suites"], "modelChecks": unit["checks"], "browserChecks": data["coverage"]["browserChecks"], "baseBrowserChecks": sum(x["checks"] for x in browsers), "nativeChecks": data["coverage"]["nativeChecks"], "totalPdfFiles": data["coverage"]["pdfFiles"], "totalPdfPages": data["coverage"]["pdfPages"], "pdfPages": pdf["pages"], "paginationPdfFiles": pdf_regression["files"], "paginationPdfPages": pdf_regression["pages"], "catalogBrowserChecks": sum(item["checks"] for item in catalog), "genericChartChecks": GENERIC_CHECKS * 3, "genericPdfFiles": generic_charts["visual"]["files"], "genericPdfPages": generic_charts["visual"]["pages"], "desktopUnitChecks": desktop["unitChecks"], "localChecksPass": True, "ciChecksPass": ci["passed"], "implementationComplete": ci["passed"]}))


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print("FAIL 2.21.0 verification: " + str(error), file=sys.stderr)
        raise SystemExit(1)
