"""Verify 2.19.1 evidence without editing tests; --freeze records approved evidence."""
from pathlib import Path
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
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION, DESKTOP_VERSION = "2.19.1", "2.19.1-desktop.1"
DEST = ROOT / "docs/acceptance-2.19.1.json"
MANIFEST = ROOT / "output/acceptance-manifest.json"
EVIDENCE = {
    "unit": "output/tests/v2.19.1/unit-results.json",
    "semantics": "output/tests/v2191-semantics/model-results.json",
    "compatibility": "output/playwright/v2191-compat/summary.json",
    "renders": "output/playwright/v2191-layout/renders.json",
    "visual": "output/playwright/v2191-layout/visual-review.json",
    "supplemental": "output/playwright/v2191-layout/supplemental-visuals.json",
    "isometricPdf": "output/playwright/v2191-layout/isometric-pdf.json",
    "desktopUnit": "output/tests/v2191-desktop/update-unit-results.json",
    "package": "output/desktop-package/package-check.json",
    "nativeSmoke": "output/tests/v2191-desktop/packaged-native-smoke/results.json",
    "nativeUpdates": "output/tests/v2191-desktop/packaged-native-updates/native-update-results.json",
}
BROWSER_SPECS = [
    ("settings", "output/playwright/v2191-settings/{channel}.json", "desktop-settings-v2191-browser-tests.cjs", 9),
    ("layout", "output/playwright/v2191-layout/{channel}.json", "layout-v2191-browser-tests.cjs", 11),
    ("acquisition", "output/playwright/v2191-compat/acquisition/{channel}-results.json", "acquisition-v219-browser-tests.cjs", 7),
    ("storage", "output/playwright/v2191-compat/storage/{channel}.json", "storage-v219-browser-tests.cjs", 8),
    ("excel", "output/playwright/v2191-compat/excel/{channel}-results.json", "excel-workflow-browser-tests.cjs", 15),
]
CI_RESULTS = {
    "wizard": "output/tests/v2191-desktop/installer-wizard/wizard-results.json",
    "upgrade": "output/tests/v2191-desktop/installed-upgrade/upgrade-results.json",
    "installed": "output/desktop-smoke/installed/results.json",
    "portable": "output/desktop-smoke/portable/results.json",
    "uninstall": "output/desktop-package/uninstall-data-check.json",
}
BASELINE_FIXTURE = "tests/fixtures/desktop-upgrade-baseline.json"
BASELINE_ARCHIVE_URL = "https://github.com/ZekeNiu/MotionBench/releases/download/rollback-v2.19.0-desktop.1-before-2.19.1-20261012/MotionBench-2.19.0-desktop.1-baseline.zip"
BASELINE_ARCHIVE_SHA256 = "3a73ba9539ad88c0427695e3a0916738a674e60b6e8fb44cb98488ca1ae0d54d"


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
    values = [data[key] for key in ["sourceHash", "sourceSha256", "sourceHtmlSha256", "htmlSha256"] if key in data]
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
    with tempfile.TemporaryDirectory(prefix="motionbench-verify-2191-") as temporary:
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
    unit = index.read(EVIDENCE["unit"])
    require(unit["sourceHash"] == source_hash and unit["sourceUnchanged"], "Stale unit evidence")
    index.file("tests/run-unit-tests.cjs", unit["runnerSha256"])
    registered = re.findall(r'^\s*"([^"\n]+\.cjs)",\s*$', (ROOT / "tests/run-unit-tests.cjs").read_text(encoding="utf-8"), re.M)
    require(len(unit["suites"]) == 52 and [s["name"] for s in unit["suites"]] == registered, "Unit suite list differs from frozen runner")
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
    return {**index.file(EVIDENCE["unit"]), "suites": len(unit["suites"]), "checks": sum(s["checksPassed"] for s in unit["suites"])}


def verify_browsers(index, source_hash):
    browsers, pdfs = [], {}
    for name, pattern, runner, count in BROWSER_SPECS:
        for channel in ["chrome", "msedge"]:
            relative = pattern.format(channel=channel); data = index.read(relative)
            require(data["pass"] and data["sourceUnchanged"] and source_identity(data) == source_hash, "Stale/failed browser evidence: " + relative)
            index.file("tests/" + runner, data["runnerSha256"])
            require(data["channel"] == channel and len(data["checks"]) == count and not data["errors"] and not data.get("network") and not data.get("failure"), "Browser checks failed: " + relative)
            for item in data.get("artifacts", []) + data.get("screenshots", []):
                index.item(item)
            for pdf in data.get("pdfs", []):
                index.item(pdf); diagnostic = pdf["diagnostics"]
                require(diagnostic["status"] == "complete", "Incomplete PDF: " + pdf["file"])
                for key in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
                    require(not diagnostic[key], "PDF integrity failure: " + key)
                require(not any(p.get("overflow") for p in pdf.get("pages", [])), "PDF page overflow")
                pdfs[(channel, pdf["expanded"])] = pdf
            if name == "layout":
                for row in data["layouts"]:
                    if row.get("scenario") == "isometric-three-trials":
                        require(not row["pageOverflow"] and not row["localScroll"] and not row["labelsOutside"] and not row["brokenNumbers"] and not row["misalignedSides"], "Isometric layout overflow or statistics misalignment")
                        require(len(row["rows"]) == 13 and row["statistics"] == 24, "Isometric results or statistics omitted")
                    else:
                        require(not row["overflow"], "Layout overflow")
            if name == "excel":
                require(data["legacyProducer"]["revision"] == "bdbb92cc0d6d914c6bcf5721d6eb65c2296c7d02", "Legacy producer identity changed")
                for file, expected in data["legacyProducer"]["modules"].items():
                    content = subprocess.check_output(["git", "show", data["legacyProducer"]["revision"] + ":" + file], cwd=ROOT)
                    require(hashlib.sha256(content).hexdigest() == expected, "Legacy producer module mismatch: " + file)
                vendor = subprocess.check_output(["git", "show", data["legacyProducer"]["revision"] + ":vendor/exceljs.min.js"], cwd=ROOT)
                require(hashlib.sha256(vendor).hexdigest() == data["legacyProducer"]["vendorSha256"], "Legacy ExcelJS mismatch")
                require(len(data["downloads"]) >= 6, "Missing real current/legacy workbook pairs")
                for workbook in data["downloads"]:
                    require(workbook["uiSchema"] == 3 and workbook["legacySchema"] == 2, "Wrong compatibility schema")
                    for prefix in ["ui", "legacy"]:
                        item = index.file(workbook[prefix + "Path"], workbook[prefix + "Sha256"])
                        with zipfile.ZipFile(ROOT / item["path"]) as archive:
                            require(archive.testzip() is None and "xl/workbook.xml" in archive.namelist(), "Damaged real XLSX")
                require(all(not row["overflow"] and not row["modalOverflow"] for row in data["layouts"]), "Excel preview overflow")
                index.file(f"output/playwright/v2191-compat/excel/{channel}-preview-export.html")
                index.file(f"output/playwright/v2191-compat/excel/{channel}-legacy-selected-directions.json")
                for width in [1440, 1280, 900, 390]:
                    index.file(f"output/playwright/v2191-compat/excel/{channel}-preview-{width}.png")
                index.file(f"output/playwright/v2191-compat/excel/{channel}-dsi-settings-390.png")
            if name == "storage":
                index.file(f"output/playwright/v2191-compat/storage/{channel}-migration-report.json")
                backup = index.file(f"output/playwright/v2191-compat/storage/{channel}-raw-upgrade-backup.jsonl")
                rows = [json.loads(line) for line in (ROOT / backup["path"]).read_text(encoding="utf-8").splitlines() if line.strip()]
                require({"record", "profile"} <= {row.get("type") for row in rows}, "Upgrade backup lacks raw records or schemes")
                index.file(f"output/playwright/v2191-compat/storage/{channel}-report.png")
            browsers.append({"name": name, "channel": channel, "checks": count, **index.file(relative)})
    compatibility = index.read(EVIDENCE["compatibility"])
    require(compatibility["sourceHash"] == source_hash and compatibility["checksPassed"] == 60, "Stale compatibility aggregate")
    for run in compatibility["runs"]:
        index.file(run["resultPath"], run["resultSha256"])
    return browsers, pdfs


def verify_pdf(index, source_hash, pdfs):
    from PIL import Image
    from pypdf import PdfReader
    renders, visual = index.read(EVIDENCE["renders"]), index.read(EVIDENCE["visual"])
    require(source_identity(renders) == source_hash and source_identity(visual) == source_hash and renders["pass"] and visual["pass"], "Stale PDF rendering/review evidence")
    require(len(renders["cases"]) == len(visual["pdfReviews"]) == 4, "Missing one of four PDF cases")
    for item in visual["browserEvidence"] + [visual["renderEvidence"], visual["supplementalEvidence"], visual["isometricPdfEvidence"]] + visual["screenshotsReviewed"]:
        index.item(item)
    supplemental = index.read(EVIDENCE["supplemental"])
    require(source_identity(supplemental) == source_hash, "Stale supplemental visual evidence")
    for item in supplemental["artifacts"]:
        index.item(item)
    cases = {(case["channel"], case["expanded"]): case for case in renders["cases"]}
    require(set(cases) == set(pdfs), "Rendering and actual downloaded PDFs differ")
    reviews = {(case["channel"], case["expanded"]): case for case in visual["pdfReviews"]}
    direct = 0
    for key, case in cases.items():
        index.item(case["pdf"])
        require(case["pdf"]["sha256"] == pdfs[key]["sha256"], "Rendered PDF differs from downloaded PDF")
        reader = PdfReader(ROOT / case["pdf"]["path"])
        require(len(reader.pages) == len(case["pages"]) == pdfs[key]["diagnostics"]["pageCount"], "PDF page coverage differs")
        review = reviews[key]; require(review["pass"] and review["pdf"] == case["pdf"], "Visual review refers to another PDF")
        require(review["pages"] == list(range(1, len(reader.pages) + 1)), "Visual review omitted a page")
        for item in case["contactSheets"]:
            index.item(item)
        for page, entry in zip(reader.pages, case["pages"]):
            index.item(entry)
            require(abs(float(page.mediabox.width) - 595.28) < 1 and abs(float(page.mediabox.height) - 841.89) < 1, "PDF page is not A4")
            require(entry["a4"] and entry["bodyInkPixels"] > 0, "Blank rendered PDF page")
            with Image.open(ROOT / entry["path"]) as bitmap:
                pixel_hash = hashlib.sha256(bitmap.convert("RGB").tobytes()).hexdigest()
            require(pixel_hash == entry["pixelSha256"], "Altered rendered page pixels")
            if key[0] == "chrome":
                require(review["directVisualReview"] and entry["visualReviewedDirectly"], "Chrome page lacks direct visual review")
                direct += 1
            else:
                counterpart = cases[("chrome", key[1])]["pages"][entry["page"] - 1]
                require(not review["directVisualReview"] and entry["visuallyVerifiedByMatchingReviewedChromePixels"] and pixel_hash == counterpart["pixelSha256"], "Edge page differs from reviewed Chrome page")
    total = sum(len(case["pages"]) for case in cases.values())
    require(total == 48 and direct == 24 and all(c["identicalPixels"] for c in renders["comparisons"]), "Unexpected PDF review coverage")
    iso = index.read(EVIDENCE["isometricPdf"])
    require(source_identity(iso) == source_hash and iso["sourceUnchanged"] and iso["pass"] and iso["visualPass"], "Stale or failed supplemental ISO PDF")
    require(visual["isometricPdfEvidence"]["path"] == EVIDENCE["isometricPdf"], "Visual review refers to another ISO receipt")
    index.item(iso["pdf"])
    reader = PdfReader(ROOT / iso["pdf"]["path"])
    diagnostic = iso["diagnostics"]
    require(diagnostic["status"] == "complete" and len(reader.pages) == diagnostic["pageCount"] == len(iso["renders"]) == len(iso["captures"]) == 8, "Incomplete supplemental ISO PDF coverage")
    for key in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
        require(not diagnostic[key], "Supplemental ISO PDF integrity failure: " + key)
    require(diagnostic["rowCount"] == diagnostic["renderedRowCount"] == 85 and all(row["exact"] for row in diagnostic["textChecks"]), "Supplemental ISO PDF omitted or changed original rows/text")
    tables = [table for capture in iso["captures"] for table in capture["tables"]]
    require(sum(table["rows"] for table in tables) == 13 and sum(table["statistics"] for table in tables) == 24 and all(table["columns"] == 7 and table["display"] == "table" and not table["misalignedSides"] for table in tables), "Supplemental ISO PDF lost repeated statistics or alignment")
    for page, entry in zip(reader.pages, iso["renders"]):
        index.item(entry)
        require(entry["visualReviewedDirectly"] and abs(float(page.mediabox.width) - 595.28) < 1 and abs(float(page.mediabox.height) - 841.89) < 1, "Supplemental ISO PDF page lacks A4 direct visual review")
    require([item["page"] for item in iso["renders"]] == list(range(1, 9)), "Supplemental ISO PDF omitted rendered pages")
    for item in iso["contactSheets"]:
        index.file(item["path"])
    return {"files": 4, "pages": total, "directlyReviewedPages": direct, "pixelMatchedEdgePages": total - direct, "supplementalIsometricPdf": {"files": 1, "pages": 8, "directlyReviewedPages": 8, "rows": 13, "repeatedStatistics": 24, "evidence": index.file(EVIDENCE["isometricPdf"])}, "renderEvidence": index.file(EVIDENCE["renders"]), "visualEvidence": index.file(EVIDENCE["visual"])}


def verify_desktop(index, source_hash):
    unit = index.read(EVIDENCE["desktopUnit"])
    require(unit["passed"] and len(unit["checks"]) >= 23, "Desktop update unit checks failed")
    index.file("tests/desktop-update-tests.cjs", unit["testScriptSha256"])
    require(set(unit["sourceHashes"]) == {"desktop/preferences.cjs", "desktop/update-service.cjs", "desktop/update-bridge.cjs", "desktop/windows-updater.cjs", "desktop/preload.cjs"}, "Incomplete desktop-unit source binding")
    for name, expected in unit["sourceHashes"].items():
        index.file(name, expected)
    package = index.read(EVIDENCE["package"])
    require(package["version"] == DESKTOP_VERSION and package["webVersion"] == VERSION and not package["directoryOnly"] and package["updaterConfigurationPresent"], "Incomplete production desktop package")
    archive = index.file("dist-desktop/win-unpacked/resources/app.asar", package["archiveSha256"])
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
    for key, runner, count in [("nativeSmoke", "desktop-smoke.cjs", 16), ("nativeUpdates", "desktop-updates-native-tests.cjs", 5)]:
        relative = EVIDENCE[key]; data = index.read(relative)
        require(data.get("pass", data.get("passed")) and data["packaged"] and len(data["checks"]) == count and not data.get("errors") and not data.get("network"), "Native checks failed: " + relative)
        identities = [data["identity"]] + ([data["finalIdentity"]] if "finalIdentity" in data else [])
        for identity in identities:
            require(identity["sourceHtmlSha256"] == identity["runtimeHtmlSha256"] == source_hash and identity["runtimeMatchesSourceHtml"] and identity["archiveSha256"] == archive["sha256"], "Stale native runtime")
            index.file("tests/" + runner, identity["testScriptSha256"])
            index.file("tests/helpers/desktop-artifact-identity.cjs", identity["identityHelperSha256"])
            for name, expected in identity["sourceHashes"].items():
                index.file(name, expected)
            require({k: v for k, v in identity["runtimeHashes"].items() if k != "package.json"} == packed["runtimeHashes"], "Native runtime module inventory changed")
        for item in data.get("artifacts", []):
            index.item(item, Path(relative).parent)
        results.append({"name": key, "checks": count, **index.file(relative)})
    return {"unitChecks": len(unit["checks"]), "nativeChecks": 21, "archive": archive, "unitEvidence": index.file(EVIDENCE["desktopUnit"]), "packageEvidence": index.file(EVIDENCE["package"]), "native": results}


def verify_ci(index, relative, source_hash, required, artifact_root=""):
    require(not Path(artifact_root).is_absolute(), "CI artifact root must be repository-relative")
    baseline = index.read(BASELINE_FIXTURE)
    require(baseline["schema"] == 1 and baseline["version"] == "2.19.0-desktop.1" and baseline["commit"] == "71e2d905a82712f04ed725868b3ce2932cb5f5f8" and baseline["artifactId"] == 11691562131, "The fixed old desktop baseline identity changed")
    require(baseline["archiveUrl"] == BASELINE_ARCHIVE_URL and baseline["archiveSha256"] == BASELINE_ARCHIVE_SHA256 and baseline["archiveSize"] == 226308505, "The permanent old desktop ZIP differs from the verified original artifact")
    baseline_evidence = {**baseline, "fixture": index.file(BASELINE_FIXTURE)}
    root = (ROOT / artifact_root).resolve()
    require(root.is_relative_to(ROOT), "CI artifact root escaped workspace")
    if not (root / relative).is_file():
        require(not required, "Real CI installer and upgrade evidence is pending: " + relative)
        return {"status": "pending", "passed": False, "evidencePath": relative, "baseline": baseline_evidence, "requiredChecks": ["assisted directory selection", "old-to-new installed upgrade", "installed application", "portable wrapper", "uninstall preserves default data"]}
    ci = index.read(relative, artifact_root)
    require(ci.get("passed", ci.get("pass")) and source_identity(ci) == source_hash and ci["version"] == DESKTOP_VERSION and ci["webVersion"] == VERSION, "CI aggregate failed or refers to another candidate")
    require(re.fullmatch(r"[a-f0-9]{40}", ci["commit"]) and str(ci["run"]).startswith("https://github.com/ZekeNiu/MotionBench/actions/runs/"), "Invalid CI provenance")
    for item in ci["artifacts"]:
        index.item(item, artifact_root)
    producers = ci["producerScripts"]
    if isinstance(producers, dict):
        producers = [{"repoPath": name, "sha256": sha} for name, sha in producers.items()]
    names = set()
    for item in producers:
        index.file(item["repoPath"], item["sha256"]); names.add(item["repoPath"])
    require(len(producers) == 10 and {".github/workflows/desktop-windows.yml", "scripts/check-desktop-package.cjs", "tests/desktop-installer-wizard-ci.ps1", "tests/desktop-installed-upgrade-ci.ps1", BASELINE_FIXTURE, "tests/desktop-upgrade-library-ci.cjs", "tests/helpers/desktop-installer-native.cs", "tests/helpers/desktop-artifact-identity.cjs", "tests/portable-wrapper-tests.cjs", "tests/desktop-smoke.cjs"} == names, "CI aggregate omitted or duplicated producer identities")
    require(set(ci["hostSourceHashes"]) == {p.relative_to(ROOT).as_posix() for p in (ROOT / "desktop").glob("*.cjs")}, "CI aggregate omitted host modules")
    for name, expected in ci["hostSourceHashes"].items():
        index.file(name, expected)
    artifact_paths = {item["path"] for item in ci["artifacts"]}
    receipts = {key: index.read(path, artifact_root) for key, path in CI_RESULTS.items()}
    require(set(CI_RESULTS.values()) <= artifact_paths, "CI aggregate omitted real installer receipts")
    wizard, upgrade = receipts["wizard"], receipts["upgrade"]
    require(wizard["passed"] and wizard["pathEditorPresent"] and wizard["browsePresent"] and wizard["cancelledBeforeInstall"] and wizard["privateDesktopClosed"], "Real assisted directory page did not pass")
    require(any(ord(char) > 127 for char in wizard["chosenDisplayedPath"]) and " " in wizard["chosenDisplayedPath"], "Directory wizard omitted Chinese/spaced path")
    require(any(item["sha256"] == wizard["screenshotSha256"] and item["path"].endswith(".bmp") for item in ci["artifacts"]), "Missing actual directory-page capture")
    index.file("tests/desktop-installer-wizard-ci.ps1", wizard["scriptSha256"]); index.file("tests/helpers/desktop-installer-native.cs", wizard["helperSha256"])
    require(upgrade["passed"] and upgrade["oldVersion"] == "2.19.0-desktop.1" and upgrade["newVersion"] == DESKTOP_VERSION and upgrade["originalInstallLocationPreserved"] and upgrade["rawLibraryAndCredentialsPreserved"] and upgrade["ownedInstallationRemoved"], "Actual old-to-new upgrade did not pass")
    require(upgrade["previousCommit"] == "71e2d905a82712f04ed725868b3ce2932cb5f5f8", "Cross-version upgrade used another baseline")
    require(upgrade["previousArchiveVerified"] and upgrade["previousArchiveUrl"] == baseline["archiveUrl"] and upgrade["previousArchiveSha256"] == baseline["archiveSha256"] and upgrade["previousArchiveSize"] == baseline["archiveSize"] and upgrade["baselineFixtureSha256"] == baseline_evidence["fixture"]["sha256"], "Upgrade did not verify the permanent old-version ZIP")
    index.file("tests/desktop-installed-upgrade-ci.ps1", upgrade["scriptSha256"])
    seed_result = index.read("output/tests/v2191-desktop/installed-upgrade/seed-results.json", artifact_root)
    verified = index.read("output/tests/v2191-desktop/installed-upgrade/verify-results.json", artifact_root)
    require({"output/tests/v2191-desktop/installed-upgrade/seed-results.json", "output/tests/v2191-desktop/installed-upgrade/verify-results.json"} <= artifact_paths, "CI aggregate omitted upgrade library receipts")
    require(seed_result["passed"] and seed_result["phase"] == "seed" and seed_result["version"] == "2.19.0-desktop.1" and not seed_result.get("error"), "Previous app did not produce the real upgrade seed")
    require(verified["passed"] and verified["phase"] == "verify" and verified["version"] == DESKTOP_VERSION and not verified.get("error") and verified["runtimeHtmlSha256"] == source_hash and verified["rawMeasurementsAndIdsPreserved"] and verified["dpapiCipherAndRevisionPreserved"], "Upgraded library or encrypted settings did not survive")
    for receipt in [seed_result, verified]:
        index.file("tests/desktop-upgrade-library-ci.cjs", receipt["testScriptSha256"])
    require(seed_result["seedSha256"] == verified["seedSha256"], "Upgrade used a different seed")
    seed_file = "output/tests/v2191-desktop/installed-upgrade/synthetic-seed.json"
    index.file(seed_file, verified["seedSha256"], artifact_root)
    seed = index.read(seed_file, artifact_root)
    require(seed["synthetic"] and seed["oldArchiveSha256"] == seed_result["archiveSha256"] and seed["oldRuntimeHtmlSha256"] == seed_result["runtimeHtmlSha256"], "Upgrade seed refers to another old runtime")
    require(receipts["installed"]["pass"] and receipts["portable"]["pass"], "Installed or portable smoke failed")
    for name in ["installed", "portable"]:
        require(not receipts[name].get("errors") and not receipts[name].get("failure"), "CI application receipt contains failures")
    installed = receipts["installed"]
    require(len(installed["checks"]) == 16 and installed["artifactUnchanged"] and installed["identity"] == installed["finalIdentity"] and not installed.get("network"), "Installed CI smoke is incomplete or changed its runtime")
    identity = installed["identity"]
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
    uninstall = receipts["uninstall"]
    require(uninstall["preserved"] and uninstall["applicationRemoved"] and uninstall["uninstallerRemoved"] and uninstall["canarySha256Before"] == uninstall["canarySha256After"], "Uninstall failed to preserve default data")
    installer = [item for item in ci["artifacts"] if item["path"].endswith("-Setup-x64.exe")]
    require(len(installer) == 1 and installer[0]["sha256"] == wizard["installerSha256"] == upgrade["newInstallerSha256"], "Installer receipts are not bound to the delivered Setup")
    def asset(suffix):
        matches = [item for item in ci["artifacts"] if item["path"].endswith(suffix)]
        require(len(matches) == 1, "Missing or duplicate CI asset: " + suffix)
        return matches[0]
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
    return {"status": "passed", "passed": True, "commit": ci["commit"], "run": ci["run"], "artifactRoot": artifact_root, "evidencePath": relative, "evidence": index.file(relative, base=artifact_root), "baseline": baseline_evidence, "checks": {"installerWizard": True, "installedUpgrade": True, "installedSmoke": 16, "portableWrapper": 3, "uninstallPreservesData": True}, "runtimeIdentityMatchesLocalSource": True, "installer": index.item(installer[0], artifact_root), "portable": index.item(portable, artifact_root)}


def acceptance_markdown(data):
    pending = "Windows CI 已验证实际目录选择页面、中文空格安装路径、2.19.0-desktop.1 → 2.19.1-desktop.1 升级后原始资料与加密 AI 设置保留、安装版、便携启动与卸载保留资料。" if data["ciChecksPass"] else "CI 的真实安装目录页面、2.19.0-desktop.1 → 2.19.1-desktop.1 升级、便携程序和卸载保留资料仍待验收；当前结论只覆盖本机已完成检查。"
    confidence = "高（本机与真实 Windows CI 检查均通过）" if data["ciChecksPass"] else "高（已核验的本机检查）"
    ci_result = "目录页、旧版升级、安装版 16 项、便携 3 项与卸载保留资料通过" if data["ciChecksPass"] else "真实安装、旧版升级与便携流程待最终验收"
    return f"""# MotionBench 2.19.1 验收记录

置信度：{confidence}。{pending}

HTML 版本 **2.19.1**；Windows 版本 **2.19.1-desktop.1**。成品 SHA256：

`{data['artifact']['sha256']}`

| 检查 | 结果 |
|---|---:|
| 模型与数据合同 | {data['unit']['suites']} 组，{data['unit']['checks']} 项通过 |
| Chrome / Edge 设置、报告与兼容流程 | {sum(x['checks'] for x in data['browsers'])} 项通过 |
| PDF | 4 份、48 页；Chrome 24 页直接目视，Edge 24 页逐页像素相同；另有等长重复测量 PDF 8 页全部直接目视 |
| 桌面更新单元 | {data['desktop']['unitChecks']} 项通过 |
| 正式封装程序的本机录入、保存重开、导出及更新设置 | 21 项通过 |
| Windows CI | {ci_result} |

EUR 按未舍入数值判断：大于 1.1 强调向心能力，小于或等于 1.1 强调利用 SSC 的能力。CMJ–SJ 增益沿用同一方向；概览、能力参数与 AI 输入保持一致。原测量、fDSI、iDSI、RQR、SRR、FVP 与弹性计算保持原值，独立旧基线已核对。

兼容检查使用独立合成资料库，覆盖单人／多人录入、历史 Hop 逐跳保留、任意 IMTP 时点、XLSX 保存导入、刷新恢复、重复导入、保存失败重试、并发写保护、JSONL 升级备份及回退。旧 schema2 文件由固定 v2.16.1 原导出器和原 ExcelJS 独立生成；新版 schema3 的实际界面下载同时保留。

旧版升级使用固定原始基线 ZIP：[2.19.0-desktop.1 基线]({data['ci']['baseline']['archiveUrl']})，共 {data['ci']['baseline']['archiveSize']:,} 字节，SHA256 为 `{data['ci']['baseline']['archiveSha256']}`。地址、大小、校验值与原基线提交绑定；CI 升级过程先核验完整 ZIP，再运行旧版保存及新版恢复检查。

本次检查使用独立合成资料库。窄屏为浏览器窗口模拟；AI 检查覆盖输入与过期草稿保护，真实供应商正文质量、物理手机和纸张打印未纳入本次验收。更新单元使用合成服务响应，跨版本安装结果由 CI 旧版升级证据核验。

完整文件依赖和哈希见 [JSON 清单](acceptance-2.19.1.json)。证据包须保留清单中的相对路径。默认核验入口为 `python scripts/verify_delivery.py`；最终 CI 核验使用 `python scripts/verify_v2191.py --require-ci`。只有显式 `--freeze` / `--record` 才更新本文件和 JSON，失败不会改写已有测试证据。
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--freeze", "--record", dest="freeze", action="store_true", help="Record verified acceptance JSON and Markdown")
    parser.add_argument("--require-ci", action="store_true")
    parser.add_argument("--ci-evidence", help="CI receipt path; defaults to the frozen receipt or output/tests/v2191-desktop/ci-results.json")
    parser.add_argument("--ci-artifact-root", help="Repository-relative extracted CI root; defaults to the frozen root")
    args = parser.parse_args()
    saved = json.loads(DEST.read_text(encoding="utf-8")) if DEST.exists() else {}
    frozen_ci = saved.get("ci", {}) if saved.get("recordedAt") else {}
    ci_relative = args.ci_evidence if args.ci_evidence is not None else frozen_ci.get("evidencePath", "output/tests/v2191-desktop/ci-results.json")
    ci_root = args.ci_artifact_root if args.ci_artifact_root is not None else frozen_ci.get("artifactRoot", "")
    index = EvidenceIndex()
    artifact, sources = verify_source(index)
    unit = verify_units(index, artifact["sha256"])
    browsers, downloads = verify_browsers(index, artifact["sha256"])
    pdf = verify_pdf(index, artifact["sha256"], downloads)
    desktop = verify_desktop(index, artifact["sha256"])
    ci = verify_ci(index, ci_relative, artifact["sha256"], args.require_ci, ci_root)
    index.file("scripts/verify_v2191.py"); index.file("scripts/verify_delivery.py")
    for item in list(index.files.values()):
        index.file(item["path"], item["sha256"])
    data = {"version": VERSION, "desktopVersion": DESKTOP_VERSION, "status": "passed" if ci["passed"] else "local-passed-ci-pending", "pass": True, "passScope": "complete" if ci["passed"] else "localChecks", "localChecksPass": True, "ciChecksPass": ci["passed"], "implementationComplete": ci["passed"], "artifact": artifact, "reproducibleBuild": True, "emptyEmbeddedData": True, "sourceHashes": sources, "unit": unit, "browsers": browsers, "pdf": pdf, "desktop": desktop, "ci": ci, "dependencies": [index.files[key] for key in sorted(index.files)]}
    if args.freeze:
        data["recordedAt"] = datetime.now(timezone.utc).isoformat()
        DEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (ROOT / "docs/acceptance-2.19.1.md").write_text(acceptance_markdown(data), encoding="utf-8")
    elif DEST.exists():
        if saved.pop("recordedAt", None):
            require(saved == data, "Acceptance snapshot differs; review current evidence, then explicitly --freeze")
        else:
            require(saved.get("status") == "verification-pending" and saved.get("pass") is False, "Acceptance snapshot is missing its freeze timestamp")
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"version": VERSION, "sha256": artifact["sha256"], "modelSuites": unit["suites"], "modelChecks": unit["checks"], "browserChecks": sum(x["checks"] for x in browsers), "pdfPages": pdf["pages"], "desktopUnitChecks": desktop["unitChecks"], "localChecksPass": True, "ciChecksPass": ci["passed"], "implementationComplete": ci["passed"]}))


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print("FAIL 2.19.1 verification: " + str(error), file=sys.stderr)
        raise SystemExit(1)
