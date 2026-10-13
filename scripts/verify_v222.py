"""Verify local MotionBench 2.22 delivery against the exact tested artifacts."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--record", action="store_true")
parser.add_argument("--require-private", action="store_true")
args = parser.parse_args()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(relative):
    path = ROOT / relative
    require(path.is_file(), "Missing required evidence: " + relative)
    return json.loads(path.read_text(encoding="utf-8-sig"))


def require(condition, message):
    if not condition:
        raise SystemExit(message)


source_hash = digest(ROOT / "MotionBench.html")
require(read("package.json")["version"] == "2.22.0", "Unexpected source version")
subprocess.run([sys.executable, str(ROOT / "scripts/build.py")], cwd=ROOT, check=True)
require(digest(ROOT / "MotionBench.html") == source_hash, "Build differs from tested artifact")
html = (ROOT / "MotionBench.html").read_text(encoding="utf-8")
require("查看能力评分的计算" not in html and 'id="abilityScoreDetails"' not in html,
        "Removed calculation module remains in the product")
for file in (ROOT / "src").glob("*.js"):
    code = file.read_text(encoding="utf-8").replace("</script", "<\\/script")
    require("<script>\n" + code + "\n</script>" in html, "Source module omitted: " + file.name)

unit = read("output/tests/v222/unit-results.json")
require(unit["sourceHash"] == source_hash and unit["sourceUnchanged"], "Stale model evidence")
require(unit["runnerSha256"] == digest(ROOT / "tests/run-unit-tests.cjs"), "Changed model runner")
require(set(unit["modules"]) == {file.name for file in (ROOT / "src").glob("*.js")}, "Incomplete model module inventory")
suite_list = re.search(r'for \(const name of \[([\s\S]*?)\]\)', (ROOT / "tests/run-unit-tests.cjs").read_text(encoding="utf-8"))
require(suite_list is not None, "Cannot read expected model suite inventory")
expected_suites = re.findall(r'"([^"]+\.cjs)"', suite_list.group(1))
require([suite["name"] for suite in unit["suites"]] == expected_suites, "Incomplete model suite inventory")
for name, sha in unit["modules"].items():
    require(digest(ROOT / "src" / name) == sha, "Model input changed: " + name)
for suite in unit["suites"]:
    require(suite["exitCode"] == 0 and suite["sourceUnchanged"], "Failed model suite: " + suite["name"])
    require(suite["sha256"] == digest(ROOT / "tests" / suite["name"]), "Model test changed: " + suite["name"])

proofs = {}
pdf_files = {}


def artifact(entry, proof_path):
    file = entry.get("file") or entry.get("path")
    require(isinstance(file, str) and file, "Artifact file attribution is missing")
    path = ROOT / file if file.startswith("output/") else (ROOT / proof_path).parent / file
    require(path.exists() and digest(path) == entry["sha256"], "Changed artifact: " + str(path))
    if path.suffix.lower() == ".pdf":
        from pypdf import PdfReader
        pdf_files[str(path.relative_to(ROOT)).replace("\\", "/")] = len(PdfReader(path).pages)


def proof(relative, runner, *, native=False, source_file=None, suites=False):
    result = read(relative)
    require(result.get("pass") is True, "Failed evidence: " + relative)
    require(not result.get("errors") and not result.get("network"), "Unexpected errors/network: " + relative)
    require(isinstance(result.get("suites" if suites else "checks"), list) and result["suites" if suites else "checks"],
            "No executed checks: " + relative)
    if source_file:
        require(result.get("sourceFile") == source_file and result.get("sourceFileSha256") == digest(ROOT / source_file) and result.get("sourceUnchanged") is True,
                "Stale geometry source: " + relative)
    elif not native:
        require("sourceHash" in result and "runnerSha256" in result, "Missing test attribution: " + relative)
    if "sourceHash" in result:
        require(result["sourceHash"] == source_hash and result.get("sourceUnchanged") is True,
                "Stale source evidence: " + relative)
    if not native:
        require(result.get("runnerSha256") == digest(ROOT / runner), "Missing/changed producer: " + relative)
    if "runnerSha256" in result:
        require(result["runnerSha256"] == digest(ROOT / runner), "Changed test producer: " + relative)
    identity = result.get("identity")
    require(not native or isinstance(identity, dict) and identity.get("archiveSha256"), "Missing packaged identity: " + relative)
    if identity:
        require(result.get("packaged") is not False and identity["runtimeMatchesSourceHtml"] is True,
                "Native check did not exercise the package: " + relative)
        require(identity["runtimeHtmlSha256"] == source_hash and identity["sourceHtmlSha256"] == source_hash,
                "Native HTML mismatch: " + relative)
        require(identity["archiveSha256"] == digest(ROOT / "dist-desktop/win-unpacked/resources/app.asar"),
                "Native archive changed: " + relative)
        require(identity["executableSha256"] == digest(ROOT / "dist-desktop/win-unpacked/MotionBench.exe"), "Native executable changed")
        require(identity["testScriptSha256"] == digest(ROOT / runner), "Native test producer changed")
        require(identity["identityHelperSha256"] == digest(ROOT / "tests/helpers/desktop-artifact-identity.cjs"),
                "Native identity helper changed")
        runtime_files = {"desktop/" + file.name for file in (ROOT / "desktop").glob("*.cjs")}
        require(set(identity["sourceHashes"]) == {"package.json", "package-lock.json", "electron-builder.yml"} | runtime_files, "Incomplete native source inventory")
        require(set(identity["runtimeHashes"]) == {"package.json"} | runtime_files, "Incomplete native runtime inventory")
        for file, sha in identity["sourceHashes"].items():
            require(digest(ROOT / file) == sha, "Native source dependency changed: " + file)
        for file, sha in identity["runtimeHashes"].items():
            if file.startswith("desktop/"):
                require(digest(ROOT / file) == sha, "Bundled native runtime differs: " + file)
        require(result.get("artifactUnchanged") is True or result.get("finalIdentity") == identity,
                "Native identity changed during verification")
        if "versions" in result:
            versions = result["versions"]
            require(versions.get("desktop") == "2.22.0-desktop.1" and versions.get("web") == "2.22.0" and versions.get("build") == "2.22.0", "Unexpected native versions")
        else:
            require(result.get("native", {}).get("appVersion") == "2.22.0-desktop.1", "Missing native version attribution")
        if runner in {"tests/desktop-v221-management-tests.cjs", "tests/desktop-v221-pdf-tests.cjs"}:
            require(result.get("executableSha256") == identity["executableSha256"], "Native executable proof mismatch")
        if runner == "tests/desktop-v221-pdf-tests.cjs":
            require(result.get("fixtureHelperSha256") == digest(ROOT / "tests/pdf-multiaxis-v221-browser-tests.cjs"), "Changed native PDF fixture")
    for file, sha in result.get("helperHashes", {}).items():
        require(digest(ROOT / file) == sha, "Changed browser helper: " + file)
    for entry in result.get("artifacts", []) + result.get("screenshots", []):
        artifact(entry, relative)
    for entry in result.get("pdfs", []):
        artifact(entry, relative)
        diagnostic = entry.get("diagnostics")
        require(isinstance(diagnostic, dict), "Missing PDF integrity diagnostics")
        require(diagnostic["status"] == "complete", "Incomplete PDF: " + entry["file"])
        require(diagnostic["pageCount"] == pdf_files[entry["file"]], "PDF page count mismatch")
        for key in ("missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"):
            require(not diagnostic[key], "PDF integrity failure: " + key)
    proofs[relative] = {"sha256": digest(ROOT / relative), "checks": len(result.get("checks", []))}
    return result


for channel in ("chrome", "msedge", "desktop"):
    proof(f"output/playwright/v222/generic/{channel}/results.json", "tests/generic-report-browser-tests.cjs", native=channel == "desktop")
for channel in ("chrome", "msedge"):
    labels = proof(f"output/playwright/v222/generic-labels/{channel}/results.json", "tests/generic-chart-label-browser-tests.cjs", source_file="src/ringside-viz.js")
    require(labels["sourceUnchanged"] and labels["sourceFileSha256"] == digest(ROOT / labels["sourceFile"]),
            "Stale radar label geometry")
    proof(f"output/playwright/v222/multiaxis/{channel}.json", "tests/pdf-multiaxis-v221-browser-tests.cjs")
proof("output/implementation-2.20.0/report/chrome.json", "tests/report-v220-browser-tests.cjs")
proof("output/playwright/v220/storage/chrome.json", "tests/storage-v220-browser-tests.cjs")
proof("output/playwright/v220/app/chrome-results.json", "tests/app-v220-browser-tests.cjs")
proof("output/tests/v222-desktop/smoke/results.json", "tests/desktop-smoke.cjs", native=True)
proof("output/tests/v222-desktop/native-management/native-management-results.json", "tests/desktop-v221-management-tests.cjs", native=True)
proof("output/tests/v222-desktop/packaged-pdf/native-pdf-results.json", "tests/desktop-v221-pdf-tests.cjs", native=True)
desktop_unit = proof("output/tests/v222/desktop-unit/results.json", "tests/run-v222-desktop-unit.cjs", suites=True)
for file, sha in desktop_unit["runtimeHashes"].items():
    require(digest(ROOT / file) == sha, "Desktop unit runtime changed")
for suite in desktop_unit["suites"]:
    require(suite["exitCode"] == 0 and suite["sourceUnchanged"] and digest(ROOT / "tests" / suite["name"]) == suite["sha256"],
            "Desktop unit suite mismatch")
    require(digest(ROOT / suite["log"]) == suite["logSha256"], "Desktop unit log changed")

package = read("output/desktop-package/package-check.json")
require(package["version"] == "2.22.0-desktop.1" and package["webVersion"] == "2.22.0", "Package version mismatch")
require(package["archiveSha256"] == digest(ROOT / "dist-desktop/win-unpacked/resources/app.asar"), "Package proof changed")
visual = read("output/implementation-2.22.0/visual-review.json")
require(visual.get("pass") is True and visual["sourceHash"] == source_hash, "Actual PDF visual review incomplete")
for entry in visual.get("pdfs", []):
    artifact(entry, "output/implementation-2.22.0/visual-review.json")
    require(entry["pageCount"] == pdf_files[entry["file"]], "Visual PDF page count mismatch")
    require(entry.get("reviewedPages") == list(range(1, entry["pageCount"] + 1)), "Unreviewed PDF pages")
    require(len(entry.get("pages", [])) == entry["pageCount"] and sorted(page["page"] for page in entry["pages"]) == entry["reviewedPages"], "Incomplete visual page images")
    for page in entry.get("pages", []):
        artifact(page, "output/implementation-2.22.0/visual-review.json")
require(visual.get("pdfs"), "No real PDF pages reviewed")
required_visual = {entry["file"] for channel in ("chrome", "desktop") for entry in read(f"output/playwright/v222/generic/{channel}/results.json")["pdfs"]}
require(required_visual <= {entry["file"] for entry in visual["pdfs"]}, "Missing generic PDF visual review")

private = {}
if args.require_private:
    base = Path(r"D:\Application\Strength&Conditioning\MotionBench-backups\20261013-before-2.22.0\verification")
    backup = json.loads((base.parent / "manifest.json").read_text(encoding="utf-8"))
    require(backup.get("complete") is True and backup["sourceVersion"] == "2.20.1-desktop.1", "Incomplete rollback checkpoint")
    for entry in backup["files"]:
        saved = base.parent / entry["scope"] / entry["path"]
        require(saved.is_file() and saved.stat().st_size == entry["length"] and digest(saved) == entry["sha256"], "Rollback checkpoint changed")
    installation = read("output/implementation-2.22.0/local-installation.json")
    require(installation.get("pass") is True and installation["installerExitCode"] == 0 and installation["version"] == "2.22.0-desktop.1", "Local installation failed")
    installed_root = Path(r"D:\Application\Strength&Conditioning\MotionBench")
    require(Path(installation["installationDirectory"]) == installed_root, "Installation directory changed")
    require(installation["installerSha256"] == digest(ROOT / "dist-desktop/MotionBench-2.22.0-desktop.1-Setup-x64.exe"), "Installed Setup changed")
    for entry in installation["checks"]:
        require(entry["matchesTestedPackage"] is True and digest(installed_root / entry["file"]) == entry["sha256"] == digest(ROOT / "dist-desktop/win-unpacked" / entry["file"]), "Installed executable/archive differs from tested package")
    require({entry["file"] for entry in installation["checks"]} == {"MotionBench.exe", "resources/app.asar"}, "Incomplete installed identity checks")
    import os
    actual_data = Path(os.environ["APPDATA"]) / "MotionBench Desktop"
    for filename in ("ai-settings.dat", "desktop-preferences.json"):
        old, current = base.parent / "user-data" / filename, actual_data / filename
        require(old.exists() == current.exists() and (not old.exists() or digest(old) == digest(current)), "AI connection or desktop preference changed")
    private["protection"] = {"backupFiles":len(backup["files"]), "backupManifestSha256":digest(base.parent / "manifest.json"), "configurationUnchanged":True, "installationProofSha256":digest(ROOT / "output/implementation-2.22.0/local-installation.json")}
    for mode in ("candidate", "installed", "reopened"):
        file = base / mode / "receipt.json"
        result = json.loads(file.read_text(encoding="utf-8"))
        require(result.get("pass") is True and result["version"] == "2.22.0-desktop.1", "Private verification failed: " + mode)
        require(result["mode"] == mode and result["actualData"] == (mode != "candidate") and result["testArguments"] == (mode != "reopened"), "Private mode attribution mismatch")
        require(result.get("checks") and result["runnerSha256"] == digest(base.parent / "verify-private.cjs") and result["baselineSha256"] == digest(base / "baseline.json"), "Private producer/baseline mismatch")
        require(result["librarySha256"] == digest(base / mode / "library.json"), "Private library snapshot changed")
        require(result["runtimeHtmlSha256"] == source_hash and result["archiveSha256"] == package["archiveSha256"], "Private artifact mismatch")
        require(mode != "reopened" or not result["testArguments"], "Normal reopen still used test arguments")
        if mode != "reopened":
            require(result["reportsSha256"] == digest(base / mode / "reports.json") and len(result["pdfs"]) == 2, "Incomplete private report checks")
        for pdf in result["pdfs"]:
            from pypdf import PdfReader
            require(pdf["sha256"] == digest(pdf["file"]) and len(PdfReader(pdf["file"]).pages) == pdf["pageCount"], "Private PDF mismatch")
            require(pdf["diagnostic"]["status"] == "complete", "Private PDF export incomplete")
            for key in ("missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"):
                require(not pdf["diagnostic"][key], "Private PDF content integrity failed")
        private[mode] = {"sha256": digest(file), "checks": len(result["checks"]), "pdfCount": len(result["pdfs"])}

summary = {"version":"2.22.0", "desktopVersion":"2.22.0-desktop.1", "scope":"local Windows delivery; no publication", "sourceHash":source_hash,
           "modelSuites":len(unit["suites"]), "modelChecks":sum(s["checksPassed"] for s in unit["suites"]),
           "proofs":proofs, "pdfFiles":pdf_files, "pdfCount":len(pdf_files), "pdfPages":sum(pdf_files.values()),
           "visualReviewSha256":digest(ROOT / "output/implementation-2.22.0/visual-review.json"), "package":package, "private":private, "pass":True}
if args.record:
    (ROOT / "docs/acceptance-2.22.0.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps({k:summary[k] for k in ("version","pass","modelSuites","modelChecks","pdfCount","pdfPages","sourceHash")},ensure_ascii=False))
