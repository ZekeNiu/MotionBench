"""Verify 2.20.0 evidence without editing tests; --freeze records approved evidence."""
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
VERSION, DESKTOP_VERSION = "2.20.0", "2.20.0-desktop.1"
DEST = ROOT / "docs/acceptance-2.20.0.json"
MANIFEST = ROOT / "output/acceptance-manifest.json"
EVIDENCE = {
    "unit": "output/tests/v220/unit-results.json",
    "semantics": "output/tests/v2191-semantics/model-results.json",
    "visual": "output/implementation-2.20.0/report/pdf-visual-review.json",
    "desktopUnit": "output/tests/v220-desktop/update-unit-results.json",
    "package": "output/desktop-package/package-check.json",
    "nativeSmoke": "output/tests/v220-desktop/packaged-native-smoke/results.json",
    "nativeUpdates": "output/tests/v220-desktop/packaged-native-updates/native-update-results.json",
    "nativeManagement": "output/desktop-v220-management/packaged/native-management-results.json",
}
BROWSER_SPECS = [
    ("management", "output/playwright/management-v220/{channel}-results.json", "management-v220-browser-tests.cjs", 12),
    ("app", "output/playwright/v220/app/{channel}-results.json", "app-v220-browser-tests.cjs", 7),
    ("storage", "output/playwright/v220/storage/{channel}.json", "storage-v220-browser-tests.cjs", 22),
    ("settings", "output/playwright/v220/settings/{channel}.json", "desktop-settings-v2191-browser-tests.cjs", 9),
    ("report", "output/implementation-2.20.0/report/{channel}.json", "report-v220-browser-tests.cjs", 8),
]
CI_RESULTS = {
    "wizard": "output/tests/v220-desktop/installer-wizard/wizard-results.json",
    "upgrade": "output/tests/v220-desktop/installed-upgrade/upgrade-results.json",
    "installed": "output/desktop-smoke/installed/results.json",
    "portable": "output/desktop-smoke/portable/results.json",
    "uninstall": "output/desktop-package/uninstall-data-check.json",
    "management": "output/desktop-v220-management/packaged/native-management-results.json",
}
BASELINE_FIXTURE = "tests/fixtures/desktop-upgrade-baseline-v220.json"
BASELINE_ARCHIVE_URL = "https://github.com/ZekeNiu/MotionBench/releases/download/rollback-v2.19.1-desktop.1-before-2.20.0-20261013/MotionBench-2.19.1-desktop.1-baseline.zip"
BASELINE_ARCHIVE_SHA256 = "151ec75c144d5b2be39628e79ba12debde4b68996ebf7d7c2d4532a1baa2427e"


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
    with tempfile.TemporaryDirectory(prefix="motionbench-verify-220-") as temporary:
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
    require(len(unit["suites"]) == 54 and [s["name"] for s in unit["suites"]] == registered, "Unit suite list differs from frozen runner")
    require(sum(s["checksPassed"] for s in unit["suites"]) == 806, "Unit check coverage differs from approved inventory")
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
    require(len(visual["pdfs"]) == len(pdfs) == 4 and visual["pagesReviewed"] == 26, "Incomplete PDF visual coverage")
    require({item["file"] for item in visual["pdfs"]} == set(pdfs), "Visual review covers another set of PDFs")
    renderer = poppler_executable(); total = 0
    for reviewed in visual["pdfs"]:
        pdf = pdfs[reviewed["file"]]; item = index.item(reviewed)
        require(reviewed["sha256"] == pdf["sha256"] and reviewed["pass"] is True, "PDF export and visual receipt differ")
        reader = PdfReader(ROOT / item["path"])
        expected = 6 if item["path"].endswith("-primary.pdf") else 7
        require(len(reader.pages) == len(reviewed["pages"]) == len(pdf["pages"]) == pdf["diagnostics"]["pageCount"] == expected, "Actual PDF page count differs")
        require([page["page"] for page in reviewed["pages"]] == list(range(1, expected + 1)), "Visual page order differs")
        for page in reader.pages:
            require(abs(float(page.mediabox.width) - 595.28) < 1 and abs(float(page.mediabox.height) - 841.89) < 1, "Actual PDF is not A4")
        with tempfile.TemporaryDirectory(prefix="motionbench-pdf-220-") as temporary:
            prefix = Path(temporary) / "page"
            subprocess.run([renderer, "-scale-to", "1500", "-png", str(ROOT / item["path"]), str(prefix)], check=True, capture_output=True)
            for page in reviewed["pages"]:
                image = index.item(page)
                require(page["pass"] is True and page["reviewed"] is True, "Unreviewed PDF page")
                with Image.open(ROOT / image["path"]) as saved, Image.open(Path(temporary) / f"page-{page['page']}.png") as actual:
                    saved, actual = saved.convert("RGB"), actual.convert("RGB")
                    require(list(saved.size) == page["size"] == list(actual.size) and saved.tobytes() == actual.tobytes(), "Reviewed image differs from actual PDF page: " + image["path"])
                    require(max(ImageStat.Stat(saved).stddev) > 5, "Blank rendered PDF page")
                total += 1
    require(total == 26, "PDF coverage count changed")
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


def verify_desktop(index, source_hash):
    unit = index.read(EVIDENCE["desktopUnit"])
    require(unit["passed"] is True and len(unit["checks"]) == 23, "Desktop update unit checks failed")
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
    for key, runner, count in [("nativeSmoke", "desktop-smoke.cjs", 16), ("nativeUpdates", "desktop-updates-native-tests.cjs", 5), ("nativeManagement", "desktop-v220-management-tests.cjs", 12)]:
        relative = EVIDENCE[key]; data = index.read(relative)
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
            index.item(item, Path(relative).parent)
        if key == "nativeManagement":
            require(data["executableSha256"] == digest(ROOT / "dist-desktop/win-unpacked/MotionBench.exe"), "Native management used another executable")
            require(data["versions"]["desktop"] == DESKTOP_VERSION and data["versions"]["web"] == VERSION, "Native management versions differ")
            require([session["label"] for session in data["sessions"]] == ["initial", "reopened"] and all(session["isolatedUserData"] for session in data["sessions"]) and data["sessions"][0]["nativePid"] != data["sessions"][1]["nativePid"], "Native management did not restart in a separate isolated process")
            require(len(data["artifacts"]) == 12 and data["blockedNativeClose"]["windowAlive"] is True, "Native management lacks screenshots or exit protection")
        results.append({"name": key, "checks": count, **index.file(relative)})
    return {"unitChecks": len(unit["checks"]), "nativeChecks": 33, "archive": archive, "unitEvidence": index.file(EVIDENCE["desktopUnit"]), "packageEvidence": index.file(EVIDENCE["package"]), "native": results}


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
    require(len(producers) == 11 and {".github/workflows/desktop-windows.yml", "scripts/check-desktop-package.cjs", "tests/desktop-installer-wizard-ci.ps1", "tests/desktop-installed-upgrade-v220-ci.ps1", BASELINE_FIXTURE, "tests/desktop-upgrade-library-v220-ci.cjs", "tests/helpers/desktop-installer-native.cs", "tests/helpers/desktop-artifact-identity.cjs", "tests/portable-wrapper-tests.cjs", "tests/desktop-smoke.cjs", "tests/desktop-v220-management-tests.cjs"} == names, "CI aggregate omitted or duplicated producer identities")
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
    index.file("tests/desktop-installed-upgrade-v220-ci.ps1", upgrade["scriptSha256"])
    seed_result = index.read("output/tests/v220-desktop/installed-upgrade/seed-results.json", artifact_root)
    verified = index.read("output/tests/v220-desktop/installed-upgrade/verify-results.json", artifact_root)
    require({"output/tests/v220-desktop/installed-upgrade/seed-results.json", "output/tests/v220-desktop/installed-upgrade/verify-results.json"} <= artifact_paths, "CI aggregate omitted upgrade library receipts")
    require(seed_result["passed"] and seed_result["phase"] == "seed" and seed_result["version"] == "2.19.1-desktop.1" and not seed_result.get("error"), "Previous app did not produce the real upgrade seed")
    require(verified["passed"] and verified["phase"] == "verify" and verified["version"] == DESKTOP_VERSION and not verified.get("error") and verified["runtimeHtmlSha256"] == source_hash and verified["rawMeasurementsAndIdsPreserved"] and verified["dpapiCipherAndRevisionPreserved"], "Upgraded library or encrypted settings did not survive")
    for receipt in [seed_result, verified]:
        index.file("tests/desktop-upgrade-library-v220-ci.cjs", receipt["testScriptSha256"])
    require(seed_result["seedSha256"] == verified["seedSha256"], "Upgrade used a different seed")
    seed_file = "output/tests/v220-desktop/installed-upgrade/synthetic-seed.json"
    index.file(seed_file, verified["seedSha256"], artifact_root)
    seed = index.read(seed_file, artifact_root)
    require(seed["synthetic"] and seed["oldArchiveSha256"] == seed_result["archiveSha256"] and seed["oldRuntimeHtmlSha256"] == seed_result["runtimeHtmlSha256"], "Upgrade seed refers to another old runtime")
    require(receipts["installed"]["pass"] and receipts["portable"]["pass"], "Installed or portable smoke failed")
    for name in ["installed", "portable"]:
        require(not receipts[name].get("errors") and not receipts[name].get("failure"), "CI application receipt contains failures")
    installed = receipts["installed"]
    require(len(installed["checks"]) == 16 and installed["artifactUnchanged"] and installed["identity"] == installed["finalIdentity"] and not installed.get("network"), "Installed CI smoke is incomplete or changed its runtime")
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
    require(management["pass"] is True and management["synthetic"] is True and management["packaged"] is True and management["platform"] == "win32" and len(management["checks"]) == 12 and not management["errors"] and not management["network"] and not management.get("failure"), "CI native management did not pass all 12 checks")
    require(management["artifactUnchanged"] is True and management["identity"] == management["finalIdentity"], "CI native management runtime changed")
    verify_native_identity(index, management["identity"], source_hash, "desktop-v220-management-tests.cjs", identity["archiveSha256"])
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
    committed = {}
    for name, item in sorted(index.files.items()):
        if name == "MotionBench.html" or name.startswith(("src/", "desktop/", "tests/", "vendor/", "scripts/")) or name in {"package.json", "package-lock.json", "electron-builder.yml", "body-map-front.png", ".github/workflows/desktop-windows.yml"}:
            actual = hashlib.sha256(subprocess.check_output(["git", "show", ci["commit"] + ":" + name], cwd=ROOT)).hexdigest()
            require(actual == item["sha256"], "CI commit contains another source/test/helper: " + name)
            committed[name] = actual
    return {"status": "passed", "passed": True, "commit": ci["commit"], "run": ci["run"], "artifactRoot": artifact_root, "evidencePath": relative, "evidence": index.file(relative, base=artifact_root), "baseline": baseline_evidence, "checks": {"installerWizard": True, "installedUpgrade": True, "installedSmoke": 16, "portableWrapper": 3, "nativeManagement": 12, "uninstallPreservesData": True, "updateAssetSha512": True}, "commitBoundFiles": committed, "runtimeIdentityMatchesLocalSource": True, "installer": index.item(installer[0], artifact_root), "portable": index.item(portable, artifact_root)}


def verify_ci_test_receipts(index, source_hash, base, archive_hash):
    unit = index.read(EVIDENCE["unit"], base)
    registered = re.findall(r'^\s*"([^"\n]+\.cjs)",\s*$', (ROOT / "tests/run-unit-tests.cjs").read_text(encoding="utf-8"), re.M)
    require(unit["sourceHash"] == source_hash and unit["sourceUnchanged"] is True and [suite["name"] for suite in unit["suites"]] == registered and len(registered) == 54 and sum(suite["checksPassed"] for suite in unit["suites"]) == 806, "CI model suite inventory differs")
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
    confidence = "高（本机与真实 Windows CI 检查均通过）" if data["ciChecksPass"] else "高（已核验的本机检查）；真实安装升级尚未核验"
    ci_result = "真实目录选择、旧版升级、安装版 16 项、便携 3 项、原生管理 12 项、卸载保留资料与更新资产通过" if data["ciChecksPass"] else "待验收：真实目录选择、旧版升级、安装版、便携程序与卸载保留资料"
    return f"""# MotionBench 2.20.0 验收记录

置信度：{confidence}。

HTML 版本 **2.20.0**；Windows 版本 **2.20.0-desktop.1**。成品 SHA256：

`{data['artifact']['sha256']}`

| 检查 | 结果 |
|---|---:|
| 模型与数据合同 | {data['unit']['suites']} 组，{data['unit']['checks']} 项通过 |
| Chrome / Edge 管理、报告、资料保存与设置 | {sum(x['checks'] for x in data['browsers'])} 项通过 |
| PDF | 4 份、26 页；已目检图片与实际 PDF 重新渲染结果逐页一致 |
| 桌面更新单元 | {data['desktop']['unitChecks']} 项通过 |
| 正式程序本机录入、保存重开、导出、更新与管理 | {data['desktop']['nativeChecks']} 项通过 |
| Windows CI | {ci_result} |

代表指标与固定成员平均支持同一套 0–100 分转换，分值、等级与原始测量分别保留其含义。缺失或停用的能力不产生默认轴；历史代表指标仅在主动启用新计分合同后使用转换配置。旧比例的正文指纹保持兼容，影响结论的计分变化触发复核。

通用等级在最后一个条件参考组删除后恢复。文献均值、已有等级、原始测量、记录 ID 与手工正文保持原行为；独立旧版科学数值与指纹对比测试通过。报告三级标题、卡片标题、手机布局与折叠参数在网页及真实 PDF 中核对。

完整文件依赖和哈希见 [JSON 清单](acceptance-2.20.0.json)。所有检查使用合成资料。默认核验入口为 `python scripts/verify_delivery.py`；完整 CI 核验使用 `python scripts/verify_v220.py --require-ci`。只有显式 `--freeze` / `--record` 更新验收文件；`--local-stage` 仅验证本机阶段，不代表发布验收通过。
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--freeze", "--record", dest="freeze", action="store_true", help="Record verified acceptance JSON and Markdown")
    parser.add_argument("--require-ci", action="store_true")
    parser.add_argument("--ci-evidence", help="CI receipt path; defaults to the frozen receipt or output/tests/v220-desktop/ci-results.json")
    parser.add_argument("--ci-artifact-root", help="Repository-relative extracted CI root; defaults to the frozen root")
    parser.add_argument("--local-stage", action="store_true", help="Verify local evidence without requiring or consuming pending CI evidence")
    args = parser.parse_args()
    require(not (args.local_stage and args.require_ci), "--local-stage and --require-ci are mutually exclusive")
    saved = json.loads(DEST.read_text(encoding="utf-8")) if DEST.exists() else {}
    frozen_ci = saved.get("ci", {}) if saved.get("recordedAt") else {}
    ci_relative = args.ci_evidence if args.ci_evidence is not None else frozen_ci.get("evidencePath", "output/tests/v220-desktop/ci-results.json")
    ci_root = args.ci_artifact_root if args.ci_artifact_root is not None else frozen_ci.get("artifactRoot", "")
    index = EvidenceIndex()
    artifact, sources = verify_source(index)
    unit = verify_units(index, artifact["sha256"])
    browsers, downloads = verify_browsers(index, artifact["sha256"])
    pdf = verify_pdf(index, artifact["sha256"], downloads)
    desktop = verify_desktop(index, artifact["sha256"])
    scientific = scientific_protection(index)
    index.file("scripts/verify_v220.py"); index.file("scripts/verify_delivery.py"); index.file("scripts/package_v220_evidence.py")
    ci = verify_ci(index, ci_relative, artifact["sha256"], args.require_ci, ci_root, args.local_stage)
    for item in list(index.files.values()):
        index.file(item["path"], item["sha256"])
    data = {"version": VERSION, "desktopVersion": DESKTOP_VERSION, "status": "passed" if ci["passed"] else "local-passed-ci-pending", "pass": True, "passScope": "complete" if ci["passed"] else "localChecks", "localChecksPass": True, "ciChecksPass": ci["passed"], "implementationComplete": ci["passed"], "artifact": artifact, "reproducibleBuild": True, "emptyEmbeddedData": True, "sourceHashes": sources, "unit": unit, "scientificProtection": scientific, "browsers": browsers, "pdf": pdf, "desktop": desktop, "ci": ci, "dependencies": [index.files[key] for key in sorted(index.files)]}
    if args.freeze:
        data["recordedAt"] = datetime.now(timezone.utc).isoformat()
        DEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (ROOT / "docs/acceptance-2.20.0.md").write_text(acceptance_markdown(data), encoding="utf-8")
    elif DEST.exists() and not args.local_stage:
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
        print("FAIL 2.20.0 verification: " + str(error), file=sys.stderr)
        raise SystemExit(1)
