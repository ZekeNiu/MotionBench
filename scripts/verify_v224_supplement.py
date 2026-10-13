"""Bind 2.24 regression and visual evidence without extending the main proof set."""
from pathlib import Path
import argparse
import json
import re

import verify_v224 as base


ROOT, VERSION = base.ROOT, base.VERSION
REGRESSIONS = [
    ("output/playwright/v224/app/chrome-results.json", "tests/app-v220-browser-tests.cjs", "app", 7),
    ("output/playwright/v224/report-regression/chrome.json", "tests/report-v220-browser-tests.cjs", "report", 8),
    ("output/playwright/v224/generic-regression/chrome/results.json", "tests/generic-report-browser-tests.cjs", "generic", 17),
]
NATIVE = "output/desktop-smoke-v224/results.json"
NATIVE_RUNNER = "tests/desktop-smoke.cjs"
ENVIRONMENT = "output/implementation-2.24.0/clipboard-environment.json"
ENVIRONMENT_DIAGNOSTIC = "output/desktop-smoke-v224-diagnostic/clipboard-diagnosis.json"
VISUAL = "output/implementation-2.24.0/visual-review.json"
CLIPBOARD = "the existing Copy analysis data button writes the native clipboard using a real user gesture"
CHARTS = ("bar", "column", "trials", "scatter", "target", "radar")
LONGITUDINAL_PDFS = {
    f"output/playwright/v224/longitudinal/{channel}/comparison.pdf":
    f"output/playwright/v224/longitudinal/{channel}/results.json"
    for channel in ("chrome", "desktop")
}
require, digest, read = base.require, base.digest, base.read


def expected_checks(runner, kind):
    code = (ROOT / runner).read_text(encoding="utf-8")
    labels = [item[1] for item in re.findall(r"await check\(\s*(['\"])(.*?)\1", code)]
    if kind == "generic":
        labels.remove("missing-score radar and long mixed-unit panels export every measured row with explicit reasons")
        labels += [f"{kind} renders the selected values on the left and complete results on the right without changing facts" for kind in CHARTS]
    require(labels and len(labels) == len(set(labels)), "Invalid regression producer check inventory: " + runner)
    return set(labels)


def verify_artifacts(entries, relative, pdf_files):
    require(isinstance(entries, list), "Missing artifact inventory: " + relative)
    files = set()
    for entry in entries:
        base.artifact(entry, relative, pdf_files)
        value = entry.get("file") or entry.get("path")
        target = base.relative_file(value, ROOT if value.startswith("output/") else (ROOT / relative).parent)
        name = target.relative_to(ROOT).as_posix()
        require(name not in files, "Duplicate artifact: " + name)
        files.add(name)
        if "bytes" in entry:
            require(entry["bytes"] == target.stat().st_size, "Changed artifact size: " + name)
    return files


def verify_pdf(entry, pdf_files):
    name = entry.get("file")
    require(name in pdf_files and pdf_files[name] > 0, "PDF absent from verified artifacts: " + str(name))
    require(entry.get("sha256") == digest(ROOT / name), "Changed PDF diagnostic attribution: " + name)
    diagnostic = entry.get("diagnostics", {})
    require(diagnostic.get("status") == "complete" and diagnostic.get("pageCount") == pdf_files[name], "Incomplete PDF diagnostics: " + name)
    for key in ("missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"):
        require(diagnostic.get(key) == [], "PDF content mismatch: " + key + ": " + name)
    if "pages" in entry:
        require(len(entry["pages"]) == pdf_files[name], "Missing PDF capture pages: " + name)


def regression_proof(relative, runner, kind, count, source_hash, pdf_files):
    data = read(relative)
    require(data.get("pass") is True and not data.get("failure") and not data.get("error"), "Failed regression: " + relative)
    require(data.get("errors") == [] and data.get("network") == [], "Regression errors or remote requests: " + relative)
    require(data.get("synthetic") is True and data.get("channel") == "chrome", "Incorrect regression isolation/channel: " + relative)
    require(data.get("sourceHash") == source_hash and data.get("sourceUnchanged") is True, "Stale regression source: " + relative)
    require(data.get("runnerSha256") == digest(ROOT / runner), "Changed regression producer: " + relative)
    labels = expected_checks(runner, kind)
    require(len(labels) == count and isinstance(data.get("checks"), list) and len(data["checks"]) == count and set(data["checks"]) == labels, "Incomplete executed regression inventory: " + relative)
    files = verify_artifacts(data.get("artifacts", []), relative, pdf_files)
    directory = Path(relative).parent.as_posix()
    if kind == "report":
        required = {f"{directory}/chrome-report-{width}.png" for width in (1440, 1024, 390)}
        required |= {f"{directory}/chrome-primary.{suffix}" for suffix in ("json", "html", "pdf")}
        required.add(f"{directory}/chrome-mean.pdf")
        require(files == required, "Incomplete single-record report artifact inventory")
        pdfs = data.get("pdfs")
        require(isinstance(pdfs, list) and len(pdfs) == 2 and {entry.get("file") for entry in pdfs} == {f"{directory}/chrome-{mode}.pdf" for mode in ("primary", "mean")}, "Missing primary/mean PDF evidence")
        for entry in pdfs:
            verify_pdf(entry, pdf_files)
    if kind == "generic":
        required = {f"{directory}/{chart}-{view}.png" for chart in CHARTS for view in ("report", "editor-preview")}
        required |= {f"{directory}/editor-{width}.png" for width in (1440, 1024, 390)}
        required |= {f"{directory}/frozen-scatter.{suffix}" for suffix in ("json", "html")}
        required.add(f"{directory}/new-project-entered-report.png")
        require(files == required and data.get("pdfs") == [], "Generic regression evidence differs from the assigned 17-check run")
    return {"file": relative, "sha256": digest(ROOT / relative), "runner": runner, "runnerSha256": data["runnerSha256"], "checksPassing": count, "checksExpected": count, "pass": True}


def native_identity(data, source_hash, runtime):
    identity = data.get("identity")
    require(data.get("packaged") is True and data.get("platform") == "win32" and data.get("synthetic") is True, "Native regression was not isolated packaged Windows execution")
    require(isinstance(identity, dict) and identity == data.get("finalIdentity") and data.get("artifactUnchanged") is True, "Changed or missing initial/final native identity")
    require(identity.get("runtimeMatchesSourceHtml") is True and identity.get("runtimeHtmlSha256") == source_hash == identity.get("sourceHtmlSha256"), "Native regression HTML differs")
    require(identity.get("archiveSha256") == digest(base.DIST / "resources/app.asar") and identity.get("executableSha256") == digest(base.DIST / "MotionBench.exe"), "Changed packaged native regression artifact")
    require(identity.get("testScriptSha256") == digest(ROOT / NATIVE_RUNNER), "Changed native regression producer")
    require(identity.get("identityHelperSha256") == digest(ROOT / "tests/helpers/desktop-artifact-identity.cjs"), "Changed native identity helper")
    sources = {"package.json", "package-lock.json", "electron-builder.yml"} | {"desktop/" + file.name for file in (ROOT / "desktop").iterdir() if file.suffix == ".cjs"}
    require(set(identity.get("sourceHashes", {})) == sources, "Incomplete native source inventory")
    for name in sources:
        require(identity["sourceHashes"][name] == digest(ROOT / name), "Changed native source: " + name)
    require(identity.get("runtimeHashes") == runtime["runtimeHashes"], "Native regression archive inventory differs")
    for name, value in runtime["runtimeHashes"].items():
        if name.startswith("desktop/"):
            require(value == digest(ROOT / name), "Packaged native source differs: " + name)
    require(data.get("native", {}).get("appVersion") == base.DESKTOP_VERSION, "Incorrect actual native app version")


def environment_proof(source_hash):
    data = read(ENVIRONMENT)
    require(data.get("status") == "blocked" and data.get("smokeRunPending") is False and data.get("blockedCheck") == CLIPBOARD, "Unfinished or unrelated environment evidence")
    require(data.get("sourceHash") == source_hash and data.get("runnerSha256") == digest(ROOT / NATIVE_RUNNER) and data.get("smokeReceipt") == NATIVE and data.get("smokeReceiptSha256") == digest(ROOT / NATIVE), "Stale environment attribution")
    require(data.get("originalAssertionPreserved") is True and data.get("runtimeModified") is False and data.get("externalApplicationsModified") is False, "Environment receipt reports altered verification scope")
    require(isinstance(data.get("reason"), str) and data["reason"].strip(), "Missing environment failure reason")
    probes = data.get("tests")
    require(isinstance(probes, list), "Missing independent environment probes")
    native = [probe for probe in probes if probe.get("method") == "await native clipboard.writeText then readText"]
    win32 = [probe for probe in probes if probe.get("method") == "read-only Win32 clipboard availability"]
    require(len(native) == len(win32) == 1 and native[0].get("syntheticConstant") and native[0].get("copiedTextCharacters") == 0, "Missing actual native empty-clipboard evidence")
    require(win32[0].get("openClipboard") is False and win32[0].get("lastError") == 5 and win32[0].get("openClipboardWindow") == 0, "Missing actual Win32 clipboard AccessDenied evidence")
    require(data.get("diagnosticReceipt") == ENVIRONMENT_DIAGNOSTIC, "Missing original environment diagnostic")
    diagnostic = read(ENVIRONMENT_DIAGNOSTIC)
    actual_win32, actual_native = diagnostic.get("win32ReadOnlyProbe", {}), diagnostic.get("focusedNativeProbe", {})
    require(diagnostic.get("sourceHtmlSha256") == source_hash and diagnostic.get("runtimeModified") is False, "Stale original environment diagnostic")
    require(actual_win32.get("openClipboard") is False and actual_win32.get("lastError") == 5 and actual_win32.get("getOpenClipboardWindow") == 0 and actual_native.get("afterNativeWriteConstantCharacters") == 0, "Original clipboard diagnostics do not support the environment classification")
    return {"file": ENVIRONMENT, "sha256": digest(ROOT / ENVIRONMENT), "diagnosticFile": ENVIRONMENT_DIAGNOSTIC, "diagnosticSha256": digest(ROOT / ENVIRONMENT_DIAGNOSTIC), "status": "blocked", "check": CLIPBOARD, "reason": data["reason"]}


def native_proof(source_hash, runtime, pdf_files):
    data = read(NATIVE)
    require(data.get("errors") == [] and data.get("network") == [], "Native regression errors or remote requests")
    native_identity(data, source_hash, runtime)
    labels, checks = expected_checks(NATIVE_RUNNER, "native"), data.get("checks")
    require(len(labels) == 16 and isinstance(checks, list) and len(checks) == len(set(checks)), "Invalid native check inventory")
    blocked = data.get("pass") is False and set(checks) == labels - {CLIPBOARD} and bool(data.get("failure"))
    require(blocked or data.get("pass") is True and not data.get("failure") and set(checks) == labels, "Native regression has unaccounted failures or incomplete checks")
    environment = environment_proof(source_hash) if blocked else None
    cleanup = data.get("cleanup", {})
    # Successful closeNatively calls await the exit event and remove their map
    # entry. The final sessions list contains only fault-cleanup leftovers.
    require(cleanup.get("errors") == [] and cleanup.get("temporaryProfileRemoved") is True and isinstance(cleanup.get("sessions"), list) and all(session.get("closed") is True for session in cleanup["sessions"]), "Incomplete isolated native cleanup")
    artifacts = data.get("artifacts")
    verify_artifacts(artifacts, NATIVE, pdf_files)
    for kind in ("native-xlsx", "native-pdf", "native-jsonl", "screenshot", "restored-invalid-draft-screenshot"):
        require(sum(item.get("kind") == kind for item in artifacts) == 1, "Missing or duplicate native artifact: " + kind)
    pdf = next(item for item in artifacts if item.get("kind") == "native-pdf")
    pdf_file = (Path(NATIVE).parent / pdf["path"]).as_posix()
    verify_pdf({"file": pdf_file, "sha256": pdf["sha256"], "diagnostics": data.get("pdf", {}).get("diagnostics")}, pdf_files)
    require({"jumpFvp", "jumpElasticity", "sprintFvp"} <= set(data.get("pdf", {}).get("chartKinds", [])), "Native PDF omits actual chart artwork")
    require(data.get("invalidDraft") == {"restored": True, "validMeasurementPreserved": True, "corrected": True}, "Incomplete native draft recovery")
    ai = data.get("aiSettings", {})
    require(ai.get("availability", {}).get("available") is True and not ai.get("notVerified") and ai.get("ciphertext", {}).get("plaintextAbsent") is True and ai.get("restoredAfterProcessRestart") is True and ai.get("forgetSurvivesProcessRestart") is True, "Missing actual encrypted settings lifecycle")
    return {"file": NATIVE, "sha256": digest(ROOT / NATIVE), "runner": NATIVE_RUNNER, "runnerSha256": digest(ROOT / NATIVE_RUNNER), "checksPassing": len(checks), "checksExpected": 16, "pass": not blocked, "environmentIssue": environment}


def visual_proof(source_hash, runtime, pdf_files):
    data = read(VISUAL)
    require(data.get("pass") is True and data.get("sourceHash") == source_hash and data.get("errors") == [] and data.get("issues") == [], "Visual review is incomplete or belongs to another source")
    entries = data.get("pdfs")
    require(isinstance(entries, list) and len(entries) == len(LONGITUDINAL_PDFS) and {item.get("file") for item in entries} == set(LONGITUDINAL_PDFS), "Incomplete assigned longitudinal visual PDF inventory")
    for item in entries:
        name, producer = item["file"], LONGITUDINAL_PDFS[item["file"]]
        channel = "desktop" if "/desktop/" in producer else "chrome"
        runner = "tests/longitudinal-browser-tests.cjs"
        base.browser_proof(producer, runner, channel, "report", source_hash, runtime, pdf_files)
        require(item.get("producerReceipt") == producer and item.get("producerReceiptSha256") == digest(ROOT / producer) and item.get("runnerSha256") == digest(ROOT / runner), "Stale visual producer receipt: " + name)
        require(item.get("sha256") == digest(ROOT / name) and item.get("pageCount") == pdf_files[name] and item.get("issues") == [], "Changed/unresolved visual PDF: " + name)
        pages = item.get("pages")
        require(item.get("reviewedPages") == list(range(1, pdf_files[name] + 1)) and isinstance(pages, list) and len(pages) == pdf_files[name] and sorted(page.get("page") for page in pages) == item["reviewedPages"], "Missing individual visual page reviews: " + name)
        verify_artifacts(pages, VISUAL, pdf_files)
        require(all(Path(page.get("file") or page.get("path", "")).suffix.lower() == ".png" for page in pages), "Visual page proof is not a rendered PNG: " + name)
    for key in ("screenshots", "responsiveScreenshots", "browserScreenshots"):
        if key in data:
            verify_artifacts(data[key], VISUAL, pdf_files)
    return {"file": VISUAL, "sha256": digest(ROOT / VISUAL), "pdfs": len(entries), "pages": sum(item["pageCount"] for item in entries), "pass": True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--record", action="store_true")
    args = parser.parse_args()
    source_hash = digest(ROOT / "MotionBench.html")
    require(read("package.json").get("version") == VERSION, "Unexpected source version")
    pdf_files = {}
    regressions = [regression_proof(*proof, source_hash, pdf_files) for proof in REGRESSIONS]
    runtime = base.archive_identity(base.DIST / "resources/app.asar")
    require(runtime["package"].get("version") == base.DESKTOP_VERSION and runtime["package"].get("webVersion") == VERSION and runtime["runtimeHtmlSha256"] == source_hash, "Actual packaged version/HTML differs")
    native = native_proof(source_hash, runtime, pdf_files)
    visual = visual_proof(source_hash, runtime, pdf_files)
    require(digest(ROOT / "MotionBench.html") == source_hash, "Built HTML changed during verification")
    summary = {"version": VERSION, "sourceHash": source_hash, "scope": "Single-record and generic regression, native regression, and actual longitudinal PDF page review", "verifierSha256": digest(Path(__file__)), "sharedVerifierSha256": digest(ROOT / "scripts/verify_v224.py"), "regressions": regressions, "native": native, "visual": visual,
               "checksPassing": sum(item["checksPassing"] for item in regressions) + native["checksPassing"], "checksExpected": sum(item["checksExpected"] for item in regressions) + native["checksExpected"], "pdfFiles": pdf_files, "pdfCount": len(pdf_files), "pdfPages": sum(pdf_files.values()),
               "pass": native["pass"], "passedWithRecordedEnvironmentIssue": native["environmentIssue"] is not None, "status": "passed" if native["pass"] else "complete-with-recorded-environment-issue"}
    if args.record:
        (ROOT / "docs/acceptance-2.24.0-supplement.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: summary[key] for key in ("version", "status", "pass", "passedWithRecordedEnvironmentIssue", "checksPassing", "checksExpected", "pdfCount", "pdfPages", "sourceHash")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
