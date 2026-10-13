"""Verify the explicit MotionBench 2.24 evidence set against current artifact bytes."""
from pathlib import Path
import argparse
import ast
import hashlib
import json
import os
import re
import subprocess


ROOT = Path(__file__).resolve().parents[1]
VERSION, DESKTOP_VERSION = "2.24.0", "2.24.0-desktop.1"
DIST = ROOT / "dist-desktop/win-unpacked"
CHECKPOINT = Path(r"D:\Application\Strength&Conditioning\MotionBench-backups\20261014-before-2.24.0")
INSTALLED = Path(r"D:\Application\Strength&Conditioning\MotionBench")
FIXTURE = "tests/helpers/longitudinal-fixture.cjs"
STORAGE_MODULES = ["calc", "scoring", "fvp", "sprint-fvp", "sprint-elasticity", "sprint-fvp-confidence", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "model", "evaluation", "longitudinal-store", "store"]
# Required proofs are a closed inventory. A file discovered elsewhere cannot replace one.
PROOFS = [
    ("output/playwright/v224/longitudinal/chrome/results.json", "tests/longitudinal-browser-tests.cjs", "chrome", "report"),
    ("output/playwright/v224/longitudinal/msedge/results.json", "tests/longitudinal-browser-tests.cjs", "msedge", "report"),
    ("output/playwright/v224/longitudinal/desktop/results.json", "tests/longitudinal-browser-tests.cjs", "desktop", "report"),
    ("output/playwright/v224/longitudinal-ai/chrome/results.json", "tests/longitudinal-ai-browser-tests.cjs", "chrome", "ai"),
    ("output/playwright/v224/longitudinal-ai/msedge/results.json", "tests/longitudinal-ai-browser-tests.cjs", "msedge", "ai"),
    ("output/playwright/v224/longitudinal-interaction/chrome/results.json", "tests/longitudinal-interaction-browser-tests.cjs", "chrome", "interaction"),
    ("output/playwright/v224/longitudinal-interaction/msedge/results.json", "tests/longitudinal-interaction-browser-tests.cjs", "msedge", "interaction"),
    ("output/playwright/v224/longitudinal-storage/chrome/results.json", "tests/longitudinal-storage-browser-tests.cjs", "chrome", "storage"),
    ("output/playwright/v224/longitudinal-storage/msedge/results.json", "tests/longitudinal-storage-browser-tests.cjs", "msedge", "storage"),
    ("output/playwright/v224/toolbar/chrome-results.json", "tests/report-toolbar-browser-tests.cjs", "chrome", "toolbar"),
    ("output/playwright/v224/toolbar/msedge-results.json", "tests/report-toolbar-browser-tests.cjs", "msedge", "toolbar"),
]


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def digest(path):
    path = Path(path)
    require(path.is_file(), "Missing required file: " + str(path))
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def read(path):
    path = Path(path)
    if not path.is_absolute():
        path = ROOT / path
    require(path.is_file(), "Missing required evidence: " + str(path))
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (ValueError, OSError) as error:
        raise SystemExit("Invalid evidence: " + str(path) + ": " + str(error)) from error


def relative_file(value, base=ROOT):
    require(isinstance(value, str) and value and not Path(value).is_absolute(), "Invalid evidence file attribution")
    target = (base / value).resolve()
    require(target.is_relative_to(ROOT.resolve()), "Evidence file leaves workspace: " + value)
    return target


def inventory(runner):
    code = (ROOT / runner).read_text(encoding="utf-8")
    match = re.search(r"for\s*\(const name of\s*\[([\s\S]*?)\]\)", code)
    require(match is not None, "Cannot read required suite inventory: " + runner)
    names = re.findall(r"['\"]([^'\"]+\.cjs)['\"]", match.group(1))
    require(names and len(names) == len(set(names)), "Invalid suite inventory: " + runner)
    return names


def suite_proof(relative, runner, source_hash, *, desktop=False):
    data = read(relative)
    require(data.get("sourceHash") == source_hash and data.get("sourceUnchanged") is True, "Stale suite evidence: " + relative)
    require(data.get("runnerSha256") == digest(ROOT / runner), "Changed suite producer: " + relative)
    require(not desktop or data.get("pass") is True, "Failed desktop unit evidence")
    require(not data.get("errors") and not data.get("failure"), "Failed suite evidence: " + relative)
    expected = inventory(runner)
    require(isinstance(data.get("suites"), list) and [s.get("name") for s in data["suites"]] == expected, "Incomplete suite inventory: " + relative)
    actual_inputs = data.get("runtimeHashes" if desktop else "modules")
    expected_inputs = {("desktop/" + p.name if desktop else p.name): p for p in (ROOT / ("desktop" if desktop else "src")).iterdir() if p.suffix == (".cjs" if desktop else ".js")}
    require(isinstance(actual_inputs, dict) and set(actual_inputs) == set(expected_inputs), "Incomplete suite input inventory: " + relative)
    for name, path in expected_inputs.items():
        require(actual_inputs[name] == digest(path), "Changed suite input: " + name)
    for suite in data["suites"]:
        require(suite.get("exitCode") == 0 and suite.get("sourceUnchanged") is True, "Failed/incomplete suite: " + suite["name"])
        require(suite.get("sha256") == digest(ROOT / "tests" / suite["name"]), "Changed suite: " + suite["name"])
        if desktop:
            require(suite.get("logSha256") == digest(relative_file(suite.get("log"))), "Changed desktop suite log: " + suite["name"])
    return data


def expected_checks(runner, kind, channel, has_pdf):
    code = (ROOT / runner).read_text(encoding="utf-8")
    names = [match[1] for match in re.findall(r"await check\(\s*(['\"])(.*?)\1", code)]
    if kind == "report":
        if channel == "desktop":
            names.remove("report AI icon opens editable owner-bound preview and applies independently")
        else:
            names.remove("packaged app save-close-reopen preserves comparison and body")
        if not has_pdf:
            names.remove("actual comparison PDF retains all rows and charts")
    if kind == "interaction":
        names += [f"{count} selected dates remain complete in the visible tables, responsive page and reopened report" for count in (6, 12)]
    require(names and len(names) == len(set(names)), "Invalid required check inventory: " + runner)
    return set(names)


def archive_identity(archive):
    script = r"""
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=process.argv[1],archive=process.argv[2],asar=require(path.join(root,'node_modules/@electron/asar'));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const files=['package.json',...fs.readdirSync(path.join(root,'desktop')).filter(f=>f.endsWith('.cjs')).map(f=>'desktop/'+f)];
const get=file=>asar.extractFile(archive,path.normalize(file));
process.stdout.write(JSON.stringify({runtimeHtmlSha256:hash(get('MotionBench.html')),runtimeHashes:Object.fromEntries(files.map(file=>[file,hash(get(file))])),package:JSON.parse(get('package.json').toString('utf8'))}));
"""
    digest(archive)
    run = subprocess.run(["node", "-e", script, str(ROOT), str(archive)], cwd=ROOT, capture_output=True, text=True)
    require(run.returncode == 0, "Cannot inspect actual packaged archive: " + run.stderr.strip())
    return json.loads(run.stdout)


def native_identity(data, runner, source_hash, runtime):
    identity = data.get("identity")
    require(isinstance(identity, dict) and data.get("finalIdentity") == identity, "Missing or changed initial/final native identity")
    require(identity.get("runtimeMatchesSourceHtml") is True and identity.get("runtimeHtmlSha256") == source_hash == identity.get("sourceHtmlSha256"), "Native HTML differs from source")
    require(identity.get("archiveSha256") == digest(DIST / "resources/app.asar"), "Native archive differs from tested archive")
    require(identity.get("executableSha256") == digest(DIST / "MotionBench.exe"), "Native executable differs from tested executable")
    require(identity.get("testScriptSha256") == digest(ROOT / runner), "Changed native producer")
    require(identity.get("identityHelperSha256") == digest(ROOT / "tests/helpers/desktop-artifact-identity.cjs"), "Changed native identity helper")
    sources = {"package.json", "package-lock.json", "electron-builder.yml"} | {"desktop/" + p.name for p in (ROOT / "desktop").iterdir() if p.suffix == ".cjs"}
    require(isinstance(identity.get("sourceHashes"), dict) and set(identity["sourceHashes"]) == sources, "Incomplete native source inventory")
    for name in sources:
        require(identity["sourceHashes"][name] == digest(ROOT / name), "Changed native source: " + name)
    require(identity.get("runtimeHashes") == runtime["runtimeHashes"], "Actual ASAR differs from native runtime inventory")
    for name, value in runtime["runtimeHashes"].items():
        if name.startswith("desktop/"):
            require(value == digest(ROOT / name), "Packaged runtime differs from source: " + name)
    require(data.get("versions") == {"desktop": DESKTOP_VERSION, "web": VERSION, "build": VERSION}, "Native version attribution differs")


def artifact(entry, relative, pdf_files):
    require(isinstance(entry, dict), "Invalid artifact entry: " + relative)
    value = entry.get("file") or entry.get("path")
    target = relative_file(value, ROOT if isinstance(value, str) and value.startswith("output/") else (ROOT / relative).parent)
    require(entry.get("sha256") == digest(target), "Changed artifact: " + str(target))
    if target.suffix.lower() == ".pdf":
        from pypdf import PdfReader
        pdf_files[target.relative_to(ROOT).as_posix()] = len(PdfReader(target).pages)


def browser_proof(relative, runner, channel, kind, source_hash, runtime, pdf_files):
    data = read(relative)
    require(data.get("pass") is True and data.get("errors") == [] and not data.get("failure"), "Failed browser evidence: " + relative)
    require(data.get("channel") == channel, "Wrong browser channel: " + relative)
    require(data.get("runnerSha256") == digest(ROOT / runner), "Changed browser producer: " + relative)
    if kind == "storage":
        expected = {"src/ringside-" + name + ".js" for name in STORAGE_MODULES}
        require(data.get("mode") == "source-modules" and set(data.get("moduleHashes", {})) == expected, "Incomplete storage module inventory")
        for name in expected:
            require(data["moduleHashes"][name] == digest(ROOT / name), "Changed storage input: " + name)
    else:
        require(data.get("sourceHash") == source_hash and data.get("sourceUnchanged") is True, "Stale browser HTML: " + relative)
    if kind in {"report", "ai", "interaction"}:
        require(data.get("fixtureSha256") == digest(ROOT / FIXTURE), "Changed browser fixture: " + relative)
    if kind != "toolbar":
        require(data.get("synthetic") is True, "Missing isolated fixture attribution: " + relative)
    has_pdf = isinstance(data.get("pdf"), dict)
    checks = data.get("checks")
    require(isinstance(checks, list) and len(checks) == len(set(checks)) and set(checks) == expected_checks(runner, kind, channel, has_pdf), "Incomplete executed check inventory: " + relative)
    if channel == "desktop":
        native_identity(data, runner, source_hash, runtime)
    if kind == "ai":
        require(data.get("liveQualityEvidence") is False, "AI fixture must not claim live-provider quality evidence")
    for entry in data.get("artifacts", []) + data.get("screenshots", []):
        artifact(entry, relative, pdf_files)
    if kind == "report":
        required = {"comparison.json", "comparison.html", "report-desktop.png", "report-overview.png"}
        require(required <= {Path(item.get("file", "")).name for item in data.get("artifacts", [])}, "Incomplete exported report artifacts: " + relative)
        if channel in {"chrome", "desktop"}:
            require(has_pdf, "Missing actual comparison PDF: " + relative)
        if has_pdf:
            diagnostic = data["pdf"]
            pdf_path = str((Path(relative).parent / "comparison.pdf").as_posix())
            require(diagnostic.get("status") == "complete" and diagnostic.get("pageCount") == pdf_files.get(pdf_path) and pdf_files.get(pdf_path, 0) > 0, "Incomplete PDF diagnostic/page count: " + relative)
            for key in ("missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"):
                require(diagnostic.get(key) == [], "PDF content mismatch: " + key + ": " + relative)
    if kind == "toolbar":
        require({item.get("width") for item in data.get("geometry", [])} == {1440, 1280, 900, 768, 390}, "Incomplete toolbar geometry inventory")
    return {"sha256": digest(ROOT / relative), "runner": runner, "runnerSha256": data["runnerSha256"], "checks": len(checks)}


def private_proofs(source_hash, runtime):
    def library_core(library):
        value = json.loads(json.dumps(library))
        for key in ("version", "updated", "activeAthleteId", "activeRecordId", "longitudinalReports"):
            value.pop(key, None)
        for owner in value["athletes"]:
            owner.pop("updated", None)
            for record in owner["records"]:
                record.pop("updated", None)
        return value

    backup = read(CHECKPOINT / "manifest.json")
    require(backup.get("complete") is True and isinstance(backup.get("files"), list) and backup["files"], "Incomplete private rollback checkpoint")
    entries = backup["files"]
    require(len({(entry.get("kind"), entry.get("path")) for entry in entries}) == len(entries), "Duplicate checkpoint inventory")
    require({entry.get("kind") for entry in entries} == {"program", "userdata"}, "Incomplete program/userdata checkpoint")
    for entry in entries:
        target = (CHECKPOINT / entry["kind"] / entry["path"]).resolve()
        require(target.is_relative_to(CHECKPOINT.resolve()), "Checkpoint entry leaves checkpoint directory")
        require(entry.get("sha256") == digest(target) and entry.get("bytes") == target.stat().st_size, "Changed private checkpoint file")
    old_archive = CHECKPOINT / "program/resources/app.asar"
    old_runtime = archive_identity(old_archive)
    require(old_runtime["package"].get("version") == "2.22.0-desktop.1", "Wrong checkpoint baseline version")
    installation_path = "output/implementation-2.24.0/local-installation.json"
    installation = read(installation_path)
    require(installation.get("pass") is True and installation.get("installerExitCode") == 0 and installation.get("version") == DESKTOP_VERSION, "Local installation failed")
    require(Path(installation.get("installationDirectory", "")).resolve() == INSTALLED.resolve(), "Installation directory changed")
    require(installation.get("installerSha256") == digest(ROOT / f"dist-desktop/MotionBench-{DESKTOP_VERSION}-Setup-x64.exe"), "Installed setup changed")
    checks = installation.get("checks", [])
    require(len(checks) == 2 and {check.get("file") for check in checks} == {"MotionBench.exe", "resources/app.asar"}, "Incomplete installed identity inventory")
    for check in checks:
        require(check.get("matchesTestedPackage") is True and check.get("sha256") == digest(INSTALLED / check["file"]) == digest(DIST / check["file"]), "Installed program differs from tested package")
    actual_data = Path(os.environ["APPDATA"]) / "MotionBench Desktop"
    for name in ("ai-settings.dat", "desktop-preferences.json"):
        saved, current = CHECKPOINT / "userdata" / name, actual_data / name
        require(saved.exists() == current.exists() and (not saved.exists() or digest(saved) == digest(current)), "AI connection/desktop preferences changed")
    receipts = {}
    baseline_file = CHECKPOINT / "verification/baseline/snapshot.json"
    baseline = read(baseline_file)
    baseline_counts = (len(baseline["library"]["athletes"]), len(baseline["reports"]))
    for mode in ("baseline", "candidate", "installed", "reopened"):
        location = CHECKPOINT / "verification" / mode
        data = read(location / "receipt.json")
        require(data.get("pass") is True and not data.get("failure") and not data.get("errors") and data.get("checks"), "Private verification failed: " + mode)
        require(data.get("mode") == mode and data.get("actualData") == (mode in {"installed", "reopened"}) and data.get("testArguments") == (mode != "reopened"), "Private launch/profile attribution mismatch: " + mode)
        require(data.get("runnerSha256") == digest(ROOT / "tests/desktop-longitudinal-preservation.cjs"), "Changed private verification producer: " + mode)
        require(data.get("snapshotSha256") == digest(location / "snapshot.json"), "Changed private snapshot: " + mode)
        snapshot = read(location / "snapshot.json")
        require(len(snapshot["library"]["athletes"]) == baseline_counts[0] and len(snapshot["reports"]) == baseline_counts[1], "Private snapshot count differs: " + mode)
        require((data.get("athletes"), data.get("records")) == baseline_counts, "Private inventory count differs: " + mode)
        require(data.get("version") == ("2.22.0-desktop.1" if mode == "baseline" else DESKTOP_VERSION), "Private runtime version differs: " + mode)
        require(data.get("runtimeHtmlSha256") == (old_runtime["runtimeHtmlSha256"] if mode == "baseline" else source_hash), "Private HTML differs: " + mode)
        require(data.get("archiveSha256") == digest(old_archive if mode == "baseline" else DIST / "resources/app.asar"), "Private native archive differs: " + mode)
        if mode != "baseline":
            require(data.get("baselineSha256") == digest(baseline_file), "Private baseline attribution differs: " + mode)
            require(library_core(snapshot["library"]) == library_core(baseline["library"]) and snapshot["reports"] == baseline["reports"], "Private records/reports differ from baseline: " + mode)
        receipts[mode] = {"sha256": digest(location / "receipt.json"), "checks": len(data["checks"]), "athletes": data["athletes"], "records": data["records"]}
    return {"pass": True, "checkpointManifestSha256": digest(CHECKPOINT / "manifest.json"), "checkpointFiles": len(entries), "configurationUnchanged": True, "installationProofSha256": digest(ROOT / installation_path), "receipts": receipts}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--record", action="store_true")
    parser.add_argument("--require-private", action="store_true")
    args = parser.parse_args()
    source_hash = digest(ROOT / "MotionBench.html")
    require(read("package.json").get("version") == VERSION, "Unexpected source version")
    html = (ROOT / "MotionBench.html").read_text(encoding="utf-8")
    build_tree = ast.parse((ROOT / "scripts/build.py").read_text(encoding="utf-8"))
    styles = next((ast.literal_eval(node.value) for node in build_tree.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "styles" for target in node.targets)), None)
    require(isinstance(styles, list) and styles, "Cannot read current build style inventory")
    shell = (ROOT / "src/ringside-shell.html").read_text(encoding="utf-8")
    require(shell.count("<!-- RINGSIDE_STYLES -->") == shell.count("<!-- RINGSIDE_SCRIPTS -->") == 1, "Unexpected shell build markers")
    rendered_shell = shell.replace("<!-- RINGSIDE_STYLES -->", "<style>\n" + "\n".join((ROOT / "src" / name).read_text(encoding="utf-8") for name in styles) + "\n</style>")
    prefix, suffix = rendered_shell.split("<!-- RINGSIDE_SCRIPTS -->")
    require(html.startswith(prefix) and html.endswith(suffix), "Current shell/styles differ from tested HTML")
    marker = re.search(r"window\.RingsideBuild=Object\.freeze\((\{[^\n]+\})\);", html)
    require(marker is not None and json.loads(marker.group(1)).get("version") == VERSION, "Built HTML version differs")
    for file in (ROOT / "src").iterdir():
        if file.suffix == ".js":
            code = file.read_text(encoding="utf-8").replace("</script", "<\\/script")
            require("<script>\n" + code + "\n</script>" in html, "Current source omitted from built HTML: " + file.name)
    unit_path, desktop_unit_path = "output/tests/v224/unit-results.json", "output/tests/v224/desktop-unit/results.json"
    unit = suite_proof(unit_path, "tests/run-unit-tests.cjs", source_hash)
    desktop_unit = suite_proof(desktop_unit_path, "tests/run-desktop-unit-tests.cjs", source_hash, desktop=True)
    runtime = archive_identity(DIST / "resources/app.asar")
    require(runtime["package"].get("version") == DESKTOP_VERSION and runtime["package"].get("webVersion") == VERSION and runtime["runtimeHtmlSha256"] == source_hash, "Actual packaged version/HTML differs")
    package = read("output/desktop-package/package-check.json")
    require(package.get("version") == DESKTOP_VERSION and package.get("webVersion") == VERSION and package.get("archiveSha256") == digest(DIST / "resources/app.asar"), "Stale package inspection proof")
    pdf_files, proofs = {}, {}
    for relative, runner, channel, kind in PROOFS:
        proofs[relative] = browser_proof(relative, runner, channel, kind, source_hash, runtime, pdf_files)
    private = private_proofs(source_hash, runtime) if args.require_private else {"verified": False}
    require(digest(ROOT / "MotionBench.html") == source_hash, "Built HTML changed during verification")
    summary = {"version": VERSION, "desktopVersion": DESKTOP_VERSION, "scope": "Explicit longitudinal, storage, AI, toolbar and desktop unit evidence; local Windows delivery; no publication", "sourceHash": source_hash,
               "verifierSha256": digest(Path(__file__)), "modelSuites": len(unit["suites"]), "modelChecks": sum(s.get("checksPassed", 0) for s in unit["suites"]), "desktopUnitSuites": len(desktop_unit["suites"]),
               "unitProof": {"file": unit_path, "sha256": digest(ROOT / unit_path)}, "desktopUnitProof": {"file": desktop_unit_path, "sha256": digest(ROOT / desktop_unit_path)},
               "proofs": proofs, "pdfFiles": pdf_files, "pdfCount": len(pdf_files), "pdfPages": sum(pdf_files.values()), "packageProofSha256": digest(ROOT / "output/desktop-package/package-check.json"),
               "archiveSha256": digest(DIST / "resources/app.asar"), "executableSha256": digest(DIST / "MotionBench.exe"), "private": private, "privateVerified": args.require_private,
               "additionalRegressionAndVisualReview": "Not included in this verifier's explicit proof inventory", "pass": True}
    if args.record:
        (ROOT / "docs/acceptance-2.24.0.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: summary[key] for key in ("version", "pass", "modelSuites", "modelChecks", "desktopUnitSuites", "pdfCount", "pdfPages", "privateVerified", "sourceHash")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
