"""Verify frozen 2.17.5 synthetic UI evidence; do not build or run tests.

A caller must supply --expect-sha from the final freeze. Missing, stale or
incomplete evidence fails before either manifest is written. --check-only is
read-only. Storage 2.17.4 results never contribute to this acceptance.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import sys
import zipfile

sys.dont_write_bytecode = True
from verify_v217_local import ROOT, inline_modules, load, local_path, require, verify_exports
from verify_v2173_charts import registered_checks, verify_graph_pdf

VERSION = "2.17.5-local"
BASELINE = "7dfee7c4ac40c2ad6edde4ece5e2bffbc6c97e89"
CHANNELS = ("chrome", "msedge")
METRICS = ("F0", "V0", "Pmax", "F0Absolute", "PmaxAbsolute", "slope", "RFmax",
           "DRF", "Vmax", "endVelocity", "Vopt")
CONFIDENCE = "src/ringside-sprint-fvp-confidence.js"
DISPLAY_RUNNER = "tests/sprint-fvp-display-browser-tests.cjs"
GRAPH_RUNNER = "tests/fvp-three-region-browser-tests.cjs"
MANIFEST = "output/acceptance-manifest-2.17.5-sprint-display.json"
PUBLIC = "docs/acceptance-2.17.5-local.json"
ALLOWED_SOURCE_CHANGES = {
    "src/ringside-model.js", "src/ringside-tests.js", "src/ringside-excel.js",
    "src/ringside-report.js", "src/ringside-viz.js", "src/ringside-app.js",
    "src/ringside-sprint-fvp-entry.js", "src/ringside-sprint-fvp.js",
}


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def artifact(value):
    path = local_path(value)
    return {"path": path.relative_to(ROOT).as_posix(), "sha256": digest(path),
            "bytes": path.stat().st_size}


def verify_item(item):
    actual = artifact(item["path"])
    require(item.get("sha256") == actual["sha256"], "Artifact hash changed: " + item["path"])
    require("bytes" not in item or item["bytes"] == actual["bytes"], "Artifact size changed: " + item["path"])
    if Path(item["path"]).suffix.lower() == ".png":
        with local_path(item["path"]).open("rb") as stream:
            header = stream.read(24)
        require(header[:8] == b"\x89PNG\r\n\x1a\n" and len(header) == 24
                and all(struct.unpack(">II", header[16:24])), "Unreadable or empty PNG: " + item["path"])
    return actual


def baseline_blob(relative):
    return subprocess.check_output(["git", "--no-optional-locks", "show", BASELINE + ":" + relative], cwd=ROOT)


def baseline_paths(directory):
    return subprocess.check_output(["git", "--no-optional-locks", "ls-tree", "-r", "--name-only", BASELINE, directory],
                                   cwd=ROOT, text=True).splitlines()


def verify_core_sprint_patch():
    relative = "src/ringside-sprint-fvp.js"
    original = baseline_blob(relative).decode("utf-8").replace("\r\n", "\n")
    current = local_path(relative).read_text(encoding="utf-8")
    # Restore the authorized presentation/protocol changes in memory and then
    # compare the entire module, including its least-squares and mechanics math.
    restored = current.replace('label: "冲刺FVP"', 'label: "分段计时冲刺 F–V/P–V"')
    guard = re.search(r"^    // A numerical identifiability check.*?(?=^    const mean =)", restored, re.M | re.S)
    require(guard is not None and all(token in guard.group(0) for token in
            ("jacobian", "scales", "determinant", "Number.isFinite(condition)", "condition>1e10")),
            "The authorized numerical rank/conditioning guard is missing or changed")
    restored = restored[:guard.start()] + restored[guard.end():]
    old_protocol = re.search(r"^    const reason = splits.length < 4.*?^    return .*?;\n", original, re.M | re.S)
    new_protocol = re.search(r"^    const reason = splits.length < 4.*?^    return .*?;\n", restored, re.M | re.S)
    require(old_protocol is not None and new_protocol is not None and
            'splits.length < 4 ? "分段拟合至少需要 4 个有效累计分段" : ""' in new_protocol.group(0)
            and "methodNotes" in new_protocol.group(0), "Unexpected sprint protocol patch")
    restored = restored[:new_protocol.start()] + old_protocol.group(0) + restored[new_protocol.end():]
    require(restored == original, "Sprint point-estimate, mechanics, optimum or other core code changed outside the allowed patch")
    return {"pointEstimateFormulasUnchanged": True, "numericalIdentificationGuardAdded": True,
            "firstSplitMaximum10mRequired": False, "terminalMinimum30mRequired": False,
            "minimumSplits": 4, "labelUnified": True}


def in_memory_build():
    """Reconstruct the deterministic checked-in recipe without executing it."""
    code = local_path("scripts/build.py").read_text(encoding="utf-8")
    groups = re.findall(r"for name in \[(.*?)\]:", code, re.S)
    require(len(groups) == 3, "Build module registry changed; update the verifier explicitly")
    groups = [re.findall(r'"([^"\n]+)"', group) for group in groups]
    require(all(groups) and sum(group.count(Path(CONFIDENCE).name) for group in groups) == 1,
            "The confidence module must be registered once in the offline build")
    package = load("package.json")
    pieces = ["window.RingsideBuild=Object.freeze(" + json.dumps({"version": package["version"]}) + ");"]
    pieces += [local_path("src/" + name).read_text(encoding="utf-8") for name in groups[0]]
    pieces.append("window.RingsideBodyImage=" + json.dumps("data:image/png;base64," +
                  base64.b64encode(local_path("body-map-front.png").read_bytes()).decode("ascii")) + ";")
    pieces += [local_path("vendor/" + name).read_text(encoding="utf-8") for name in groups[1]]
    pieces += [local_path("src/" + name).read_text(encoding="utf-8") for name in groups[2]]
    match = re.search(r"styles = \[(.*?)\]", code, re.S)
    require(match is not None, "Cannot read the offline stylesheet registry")
    styles = re.findall(r'"([^"\n]+)"', match.group(1))
    shell = local_path("src/ringside-shell.html").read_text(encoding="utf-8")
    require(shell.count("<!-- RINGSIDE_STYLES -->") == shell.count("<!-- RINGSIDE_SCRIPTS -->") == 1,
            "Offline shell placeholders changed")
    shell = shell.replace("<!-- RINGSIDE_STYLES -->", "<style>\n" + "\n".join(
        local_path("src/" + name).read_text(encoding="utf-8") for name in styles) + "\n</style>")
    scripts = "\n".join("<script>\n" + piece.replace("</script", "<\\/script") + "\n</script>" for piece in pieces)
    return shell.replace("<!-- RINGSIDE_SCRIPTS -->", scripts)


def source_contract(expected_sha, evidence):
    require(load("package.json")["version"] == VERSION, "Package version is not the final 2.17.5 candidate")
    main = artifact("MotionBench.html")
    require(main["sha256"] == expected_sha and artifact("Ringside_Boxing_Assessment.html")["sha256"] == expected_sha,
            "Frozen HTML hash or standalone alias differs")
    html = local_path(main["path"]).read_text(encoding="utf-8")
    require(re.search(r'<script id="embedded-data" type="application/json">\s*null\s*</script>', html),
            "Standalone delivery contains a saved record")
    require(in_memory_build() == html, "Checked-in build inputs differ from the frozen HTML")
    modules = inline_modules(html)
    original = set(baseline_paths("src"))
    current = {path.relative_to(ROOT).as_posix() for path in (ROOT / "src").iterdir() if path.is_file()}
    require(current == original | {CONFIDENCE}, "Unexpected source module added or removed")
    protected = []
    for relative in sorted(original - ALLOWED_SOURCE_CHANGES):
        require(local_path(relative).read_bytes() == baseline_blob(relative), "Source outside the UI/CI scope changed: " + relative)
        protected.append(artifact(relative))
    store = local_path("src/ringside-store.js").read_text(encoding="utf-8")
    require('indexedDB.open("motionbench-v3:"+pathname,1)' in re.sub(r"\s+", "", store)
            and 'schema:3' in store, "IndexedDB or backup schema differs from the isolated baseline")
    core_patch = verify_core_sprint_patch()
    old_assets = []
    preserved = ["downloads/MotionBench-v2.17.3-local-preview.zip"] + [
        path for path in baseline_paths("downloads/chart-restore-2.17.3") if path.endswith(".png")]
    require(len(preserved) == 9, "Cannot identify all eight historical screenshot assets")
    for relative in preserved:
        require(local_path(relative).read_bytes() == baseline_blob(relative), "Historical delivery asset changed: " + relative)
        old_assets.append(artifact(relative))
    evidence.update({"html": main, "htmlAlias": artifact("Ringside_Boxing_Assessment.html"),
                     "buildRecipe": artifact("scripts/build.py"), "package": artifact("package.json")})
    return modules, {"baselineCommit": BASELINE, "storageRepairsIncluded": False, "backupSchema": 3,
                     "indexedDBVersion": 1, "pointMathChanged": False, "coreSprintPatch": core_patch,
                     "protectedSources": protected,
                     "historicalAssets": old_assets, "historicalAssetsIncludedInCurrentAcceptance": False}


def registered_units():
    code = local_path("tests/run-unit-tests.cjs").read_text(encoding="utf-8")
    match = re.search(r"for\s*\(\s*const\s+name\s+of\s*\[(.*?)\]\s*\)", code, re.S)
    require(match is not None, "Cannot resolve current unit registry")
    names = re.findall(r'["\']([^"\'\n]+\.cjs)["\']', match.group(1))
    require(names and len(names) == len(set(names)), "Empty or duplicate unit registry")
    require({"sprint-fvp-confidence-model-tests.cjs", "sprint-fvp-display-report-model-tests.cjs",
             "sprint-fvp-display-model-tests.cjs", "sprint-fvp-entry-controls-tests.cjs"} <= set(names),
            "Current unit registry omits a new CI, display or entry suite")
    old_match = re.search(r"for\s*\(\s*const\s+name\s+of\s*\[(.*?)\]\s*\)",
                          baseline_blob("tests/run-unit-tests.cjs").decode("utf-8"), re.S)
    require(old_match is not None and set(re.findall(r'["\']([^"\'\n]+\.cjs)["\']', old_match.group(1))) <= set(names),
            "Current unit registry dropped a baseline regression suite")
    return names


def verify_units(directory, sha, modules, evidence):
    relative = directory + "/unit-results.json"; data = load(relative)
    require(data.get("sourceHash") == sha and data.get("sourceUnchanged") is True,
            "Unit run is not bound to the frozen HTML")
    require(data.get("runnerSha256") == digest(local_path("tests/run-unit-tests.cjs")), "Unit runner changed after execution")
    require(data.get("modules") == modules, "Unit run used a different JavaScript module set")
    names = registered_units(); suites = data["suites"]
    require(len(suites) == len(names) and {suite["name"] for suite in suites} == set(names), "Unit registry was not completely executed")
    for suite in suites:
        require(suite.get("exitCode") == 0 and type(suite.get("checksPassed")) is int and suite["checksPassed"] > 0,
                "Unit suite failed or has no checks: " + suite["name"])
        require(suite.get("sha256") == digest(local_path("tests/" + suite["name"]))
                and suite.get("sourceUnchanged") is True, "Unit suite input changed: " + suite["name"])
    evidence["units"] = artifact(relative)
    return {"pass": True, "suiteCount": len(suites), "checks": sum(suite["checksPassed"] for suite in suites),
            "runner": artifact("tests/run-unit-tests.cjs"),
            "inputs": [artifact("tests/" + name) for name in names]}


def verify_point_estimates(relative, modules, evidence):
    data = load(relative)
    require(data.get("syntheticOnly") is True and data.get("baselineRef") == BASELINE[:8],
            "Point-estimate comparison used another baseline or real records")
    runner = "tests/sprint-fvp-display-model-tests.cjs"
    require(data["suiteSha256"] == digest(local_path(runner)), "Point-estimate comparison suite changed after execution")
    require(set(data["baselineSources"]) == {"src/ringside-calc.js", "src/ringside-sprint-fvp.js"},
            "Point-estimate comparison baseline inputs differ")
    for path, value in data["baselineSources"].items():
        require(hashlib.sha256(baseline_blob(path)).hexdigest() == value, "Point-estimate baseline source hash differs")
    require(data["currentSources"] and all(modules.get(Path(path).name) == value
                                          for path, value in data["currentSources"].items()),
            "Point-estimate comparison used stale current modules")
    cases = data["cases"]
    require(len(cases) == data["exactCases"] == 4 and len({case["name"] for case in cases}) == 4
            and all(case.get("exact") is True and case["baseline"] == case["actual"]
                    and case["actual"]["fit"]["valid"] is True and case["actual"]["model"]["valid"] is True
                    for case in cases), "Shared valid point estimates differ from the actual baseline")
    oracle_path = "tests/fixtures/sprint-display-v2173/baseline-point-oracle.json"
    oracle = load(oracle_path)
    require(oracle["sourceHashes"] == data["baselineSources"] and oracle.get("syntheticOnly") is True
            and oracle["baselineRef"] == BASELINE[:8], "Point-estimate oracle identity differs")
    expected_cases = {case["name"]: case["expected"] for case in oracle["cases"]}
    require({case["name"] for case in cases} == set(expected_cases)
            and all(case["baseline"] == expected_cases[case["name"]] for case in cases),
            "Point-estimate comparison no longer matches the actual baseline oracle")
    evidence["pointEstimateBaselineComparison"] = artifact(relative)
    return {"pass": True, "exactCases": len(cases), "caseNames": [case["name"] for case in cases],
            "result": artifact(relative), "suite": artifact(runner), "oracle": artifact(oracle_path),
            "oracleProducer": artifact("tests/fixtures/sprint-display-v2173/write-baseline-point-oracle.cjs"),
            "baselineSources": data["baselineSources"], "currentSources": data["currentSources"]}


def browser_identity(data, relative, channel, sha, runner, expected):
    require(data.get("sourceHash", data.get("sourceSha256")) == sha and data.get("sourceUnchanged") is True,
            "Browser result is stale: " + relative)
    require(data.get("synthetic") is True and data.get("pass") is True and data.get("channel") == channel,
            "Synthetic browser suite did not pass: " + relative)
    require(data.get("runnerSha256") == digest(local_path(runner)), "Browser runner changed after execution: " + relative)
    if "helperSha256" in data:
        helper_paths = {"playwright": "tests/helpers/playwright.cjs", "excelTemplate": "tests/helpers/excel-template.cjs"}
        require(set(data["helperSha256"]) == set(helper_paths), "Browser helper registry differs")
        require(all(data["helperSha256"][key] == digest(local_path(path)) for key, path in helper_paths.items()),
                "Browser helper changed after execution")
    for item in data.get("fixtureHashes", []):
        verify_item(item)
    require(data.get("errors") == data.get("network") == [] and data.get("failures", []) == [],
            "Browser run contains errors, external requests or failures: " + relative)
    checks = data["checks"]
    names = list(checks) if isinstance(checks, dict) else [row if isinstance(row, str) else row["name"] for row in checks]
    require(len(names) == len(expected) and set(names) == set(expected), "Browser scenario registry differs: " + relative)
    if isinstance(checks, dict):
        require(all(row.get("status") == "passed" for row in checks.values()), "Browser check did not pass")
    for item in data["artifacts"]:
        verify_item(item)
    return {"channel": channel, "pass": True, "checks": len(names), "result": artifact(relative),
            "runner": artifact(runner),
            "helpers": [artifact(helper_paths[key]) for key in data.get("helperSha256", {})],
            "fixtures": [artifact(item["path"]) for item in data.get("fixtureHashes", [])],
            "artifacts": [artifact(item["path"]) for item in data["artifacts"]]}


def verify_display_exports(data, channel, modules):
    items = {Path(item["path"]).name: item for item in data["artifacts"]}
    saved = data["saved"]
    require(saved["view"] == saved.get("sprintFvpView", saved["view"]), "Saved display view is inconsistent")
    view = saved["view"]
    require(all(type(view.get(key)) is bool for key in ("fv", "pv", "optimum", "confidence")), "Saved curve controls are incomplete")
    require(all(type(view.get("metrics", {}).get(key)) is bool for key in METRICS), "Saved parameter controls are incomplete")
    subset = lambda record: {"raw": record["data"]["sprint_fvp"], "config": record["sprintFvpConfig"],
                             "analysis": record["sprintFvpAnalysis"], "view": record["sprintFvpView"],
                             "selections": record["views"]["capabilitySelections"]}
    expected = {key: saved[key] for key in ("raw", "config", "analysis", "view", "selections")}
    require(saved["config"].get("methodVersion") == "samozino-2016-splits-v1"
            and saved["config"].get("sampleStepS") == .1 and saved["config"].get("rfAfterS") == .3
            and saved["config"].get("samplingWindow") == "terminal_time", "Saved mechanics metadata changed")
    record = load(items[channel + "-record.json"]["path"])["record"]
    require(subset(record) == expected, "Record JSON changed the saved sprint facts or display settings")
    rows = [json.loads(line) for line in local_path(items[channel + "-backup.motionbench.jsonl"]["path"]).read_text(
        encoding="utf-8-sig").splitlines() if line.strip()]
    header = next(row for row in rows if row.get("type") == "header")
    config = next(row["value"] for row in rows if row.get("type") == "config")
    require(header["schema"] == config["schema"] == 3 and config["version"] == VERSION, "JSONL schema or producer differs")
    require(any(subset(row["value"]) == expected for row in rows if row.get("type") == "record"), "JSONL lacks the saved display settings")
    report_html = local_path(items[channel + "-report.html"]["path"]).read_text(encoding="utf-8")
    require(inline_modules(report_html) == modules, "Editable report contains stale application modules")
    for suffix in ("template.xlsx", "filled.xlsx"):
        with zipfile.ZipFile(local_path(items[channel + "-" + suffix]["path"])) as book:
            require({"[Content_Types].xml", "xl/workbook.xml"} <= set(book.namelist()) and book.testzip() is None,
                    "Excel download is unreadable or corrupted: " + suffix)
    def without_internal_ids(value):
        if isinstance(value, dict):
            return {key: without_internal_ids(item) for key, item in value.items() if key != "id"}
        if isinstance(value, list):
            return [without_internal_ids(item) for item in value]
        return value
    identity = data["excelInternalIdentity"]
    preserved = ("recordIdPreserved", "athleteIdPreserved", "measurementFieldsExactlyPreserved")
    require(all(identity.get(key) is True for key in preserved)
            and without_internal_ids(identity["before"]) == without_internal_ids(identity["after"]),
            "Excel changed measurement fields or record/athlete identity")
    legacy = data["legacyExcel"]
    require({Path(item["path"]).name for item in legacy} == {
        "baseline-sprint-schema1.xlsx", "baseline-sprint-schema2.xlsx"} and len(legacy) == 2,
        "Legacy Excel schema 1/2 coverage is incomplete")
    for item in legacy:
        verify_item(item)
        require(all(item.get(key) is True for key in preserved)
                and without_internal_ids(item["internalIdentityBefore"]) == without_internal_ids(item["internalIdentityAfter"])
                and without_internal_ids(item["saved"]["raw"]) == without_internal_ids(item["nondefaultPreserved"]["raw"])
                and all(item["saved"][key] == item["nondefaultPreserved"][key] for key in ("config", "analysis", "selections")),
                "Legacy Excel import/save changed measurements, metadata or record/athlete identity")
    return {"saved": expected, "backupSchema": 3, "producerVersion": VERSION,
            "excelSettingsValidatedByBrowserRoundTrip": True,
            "excelInternalIdentity": {key: identity[key] for key in (*preserved, "contract")},
            "legacyExcel": [{**artifact(item["path"]), **{key: item[key] for key in preserved}} for item in legacy]}


def verify_display(directory, sha, modules, evidence):
    code = local_path(DISPLAY_RUNNER).read_text(encoding="utf-8")
    registry = re.search(r'const checkRegistry=\[(.*?),\.\.\.\(process\.argv\.includes\("--pdf"\)\?\[("[^"\n]+")\]:\[\]\)\];', code)
    require(registry is not None, "Cannot resolve the current indexed display/PDF scenario registry")
    names = json.loads("[" + registry.group(1) + "]") + [json.loads(registry.group(2))]
    require(names and len(names) == len(set(names)) and all(isinstance(name, str) for name in names), "Invalid display scenario registry")
    indexes = [int(value) for value in re.findall(r"await check\(checkRegistry\[(\d+)\]", code)]
    require(indexes == list(range(len(names))), "Display registry is not executed exactly once in order")
    cases = []; pdfs = []
    for channel in CHANNELS:
        relative = directory + "/" + channel + "-results.json"; data = load(relative)
        case = browser_identity(data, relative, channel, sha, DISPLAY_RUNNER, names)
        require(data.get("packageVersion") == data.get("buildProducerVersion") == VERSION
                and data.get("runnerUnchanged") is True and data["checkRegistry"] == names,
                "Display browser producer, registered checks or execution input differs")
        require({layout["width"] for layout in data["layouts"]} >= {1440, 390}
                and all(layout.get("pageOverflow") is False and layout["order"] == ["jump", "elastic", "sprint"]
                        for layout in data["layouts"]), "Display layout overflows or lacks a required graph region/width")
        case["exports"] = verify_display_exports(data, channel, modules)
        # The display runner records actual browser downloads as kind=download;
        # normalize that descriptor for the existing shared PDF byte validator.
        pdf_data = dict(data)
        pdf_data["artifacts"] = [{**item, "kind": "actual-pdf"} if item["path"] == data["pdf"]["path"] else item
                                 for item in data["artifacts"]]
        case["pdf"] = verify_graph_pdf(pdf_data)
        pdfs.append((data, case["pdf"], channel)); cases.append(case)
        evidence[channel + "DisplayResults"] = artifact(relative)
    return cases, pdfs


def verify_regions(directory, sha, evidence):
    names, pdf_names = registered_checks(GRAPH_RUNNER)
    fixture = artifact("tests/fixtures/three-fvp-regions.json")
    require(load(fixture["path"])["synthetic"] is True, "Graph fixture is not synthetic")
    cases = []; pdfs = []
    for channel in CHANNELS:
        for width in (1440, 390):
            relative = f"{directory}/{channel}-{width}-results.json"; data = load(relative)
            expected = names if width == 1440 else [name for name in names if name not in pdf_names]
            case = browser_identity(data, relative, channel, sha, GRAPH_RUNNER, expected)
            require(data["width"] == width and data["fixtureSha256"] == fixture["sha256"], "Graph identity or fixture differs")
            original = data.get("calculationReference")
            require(original is not None, "Graph suite omitted the historical jump calculation comparison")
            verify_item(original); reference = load(original["path"])
            require(reference["sourceSha256"] == "a97c903c243246df6a6cb569d28a17c7bc3d35f9380bd3885d973f00d931edff"
                    and reference["fixtureSha256"] == fixture["sha256"], "Original calculation reference differs")
            initial = next(state for state in data["states"] if state["name"] == "historical-initial")
            prior = next(state for state in reference["states"] if state["name"] == "historical-initial")
            require(initial["solved"] == prior["solved"], "UI changes altered the original jump model or scenario values")
            state = next(state for state in data["states"] if state["name"] == "independent-graphs-folded-capability")
            require(state["detail"]["open"] is False and state["documentOverflow"] is False
                    and {region["kind"] for region in state["regions"]} == {"jumpFvp", "jumpElasticity", "sprintFvp"},
                    "Folded four-card details conceal a graph or overflow")
            require(all(region["bounds"]["effectiveVisible"] is True and region["svgs"]
                        and all(svg["bounds"]["effectiveVisible"] and svg["bounds"]["width"] > 100
                                and svg["bounds"]["height"] > 100 for svg in region["svgs"]) for region in state["regions"]),
                    "Folded graph is not visibly rendered")
            case["width"] = width
            if width == 1440:
                case["pdf"] = verify_graph_pdf(data); pdfs.append((data, case["pdf"], channel))
            cases.append(case); evidence[f"{channel}Graph{width}"] = artifact(relative)
    return cases, pdfs


def verify_existing_sprint(relative, sha, evidence):
    manifest = load(relative)
    runner = "tests/sprint-fvp-browser-tests.cjs"
    names, pdf_names = registered_checks(runner)
    expected = [name for name in names if name not in pdf_names]
    require(manifest.get("version") == VERSION and manifest.get("sourceHash") == sha
            and manifest["sourceBytes"] == local_path("MotionBench.html").stat().st_size
            and manifest["runnerSha256"] == digest(local_path(runner)), "Existing sprint execution manifest is stale")
    attempts = manifest["attempts"]
    require(len(attempts) == 2 and {row["channel"] for row in attempts} == set(CHANNELS),
            "Both existing sprint browser workflows must execute")
    cases = []
    for attempt in attempts:
        require(attempt.get("status") == "complete" and attempt.get("synthetic") is True
                and attempt.get("pass") is True and attempt.get("exitCode") == 0
                and attempt.get("pdf") is False and attempt.get("sourceHash") == attempt.get("sourceAfterSha256") == sha
                and attempt.get("sourceUnchanged") is True and attempt.get("runnerUnchanged") is True
                and attempt["runnerSha256"] == attempt["runnerAfterSha256"] == manifest["runnerSha256"]
                and attempt["checks"] == len(expected) and attempt["errors"] == attempt["network"] == [],
                "Existing sprint native execution did not pass against frozen inputs")
        require({item["path"] for item in attempt["inputs"]} == {
            runner, "tests/helpers/playwright.cjs", "tests/helpers/excel-template.cjs"}, "Existing sprint execution input registry differs")
        for item in [*attempt["inputs"], attempt["result"], attempt["receipt"], *attempt["artifacts"]]:
            verify_item(item)
        receipt = load(attempt["receipt"]["path"])
        require(receipt["command"] == attempt["command"] and receipt["sourceHash"] == sha
                and receipt["exitCode"] == 0 and receipt["sourceUnchanged"] is True
                and receipt["runnerUnchanged"] is True and receipt["inputs"] == attempt["inputs"],
                "Existing sprint execution receipt differs from its manifest")
        data = load(attempt["result"]["path"])
        require(data.get("pass") is True and data.get("synthetic") is True and data.get("sourceHash") == sha
                and data.get("sourceUnchanged") is True and data["channel"] == attempt["channel"]
                and data["errors"] == data["network"] == [] and len(data["checks"]) == len(expected)
                and set(data["checks"]) == set(expected), "Existing sprint browser result is stale or incomplete")
        require({(row["path"], row["sha256"]) for row in data["artifacts"]} ==
                {(row["path"], row["sha256"]) for row in attempt["artifacts"]}, "Existing sprint download/screenshot registry differs")
        require({row["width"] for row in data["layouts"]} == {1440, 900, 390}
                and all(row["pageOverflow"] is False for row in data["layouts"]), "Existing sprint layout regression failed")
        cases.append({"channel": attempt["channel"], "checks": len(expected), "pass": True,
                      "command": attempt["command"], "executionReceipt": artifact(attempt["receipt"]["path"]),
                      "result": artifact(attempt["result"]["path"]), "inputs": attempt["inputs"],
                      "artifacts": verify_exports(data, attempt["channel"])})
    evidence["existingSprintExecutionManifest"] = artifact(relative)
    return {"pass": True, "checks": sum(row["checks"] for row in cases), "cases": cases,
            "scope": "Existing 14-scenario workflows on both browsers; actual PDF acceptance is recorded separately"}


def verify_scientific_ci(relative, scipy_relative, modules, evidence):
    data = load(relative)
    require(data.get("synthetic") is True and data.get("pass") is True and data.get("exitCode") == 0,
            "Independent CI model checks did not complete successfully")
    require(data.get("runnerPath") == "tests/sprint-fvp-confidence-model-tests.cjs"
            and data.get("runnerSha256") == digest(local_path(data["runnerPath"])), "CI science runner changed after execution")
    require(data.get("sourceModulesUnchanged") is True, "CI scientific inputs changed during execution")
    input_hashes = data.get("moduleSha256", {})
    require(set(input_hashes) == {"ringside-calc.js", "ringside-sprint-fvp.js", Path(CONFIDENCE).name},
            "CI science evidence omitted required input hashes")
    inputs = [{"path": "src/" + name, "sha256": value} for name, value in input_hashes.items()]
    for item in inputs:
        verify_item(item)
        require(modules.get(Path(item["path"]).name) == item["sha256"], "CI science input differs from final HTML")
    checks = data["results"]
    require(checks and data["checks"] == data["passed"] == len(checks) and data["failures"] == []
            and all(row.get("pass") is True for row in checks), "An independent CI scientific check failed")
    require(data.get("confidenceLevel") == .95 and data.get("methodVersion") == "sprint-fvp-pointwise-delta-v1",
            "CI confidence level or algorithm identity differs")
    numerics = data["numericEvidence"]
    require({(row["n"], row["df"]) for row in numerics} == {(4, 2), (6, 4)},
            "Independent CI evidence omitted the four/six raw split degrees of freedom")
    exclusions = {"no individual prediction interval", "no simultaneous band", "no optimum band",
                  "no fabricated residual noise", "no pseudoinverse", "no fixed-percentage band", "no derived-sample n"}
    require(exclusions <= set(data["exclusions"]), "CI scientific limits are incomplete")
    scipy = load(scipy_relative)
    require(scipy.get("pass") is True and scipy.get("exitCode") == 0
            and scipy["checks"] == scipy["passed"] and scipy["checks"] > 0,
            "Independent SciPy verification did not pass")
    require(scipy["inputPath"] == relative and scipy["inputSha256"] == digest(local_path(relative))
            and scipy["nodeRunnerSha256"] == data["runnerSha256"]
            and scipy["moduleSha256"] == data["moduleSha256"], "SciPy verification is stale relative to final confidence evidence")
    require(scipy["scriptPath"] == "output/verify/v2175-confidence-scipy-reference.py"
            and scipy["scriptSha256"] == digest(local_path(scipy["scriptPath"])), "Independent SciPy script changed after execution")
    evidence["independentConfidenceModelResults"] = artifact(relative)
    evidence["independentConfidenceSciPyResults"] = artifact(scipy_relative)
    return {"pass": True, "checks": len(checks), "result": artifact(relative), "runner": artifact(data["runnerPath"]),
            "inputs": [artifact(item["path"]) for item in inputs],
            "executionHtmlHash": data.get("sourceHtmlAtRunSha256"), "htmlWasAcceptanceSource": False,
            "numericEvidence": numerics, "sources": data["sources"],
            "independentSciPy": {"checks": scipy["checks"], "result": artifact(scipy_relative),
                                 "script": artifact(scipy["scriptPath"]), "input": artifact(relative)},
            "scope": "Independent synthetic calculation-module checks; final HTML binding is by exact module hashes",
            "method": "Approximate pointwise 95% fitted-mean intervals; split n minus two degrees of freedom; delta propagation to current F-V/P-V only",
            "optimalProfileInterval": False, "predictionInterval": False, "simultaneousBand": False,
            "inventedNoiseFloor": False, "pseudoinverseFallback": False}


def verify_visual(relative, sha, pdfs, browser_cases, evidence, scope="original-graphs"):
    data = load(relative)
    require(data.get("sourceHash", data.get("sourceSha256")) == sha and data.get("synthetic") is True
            and data.get("pass") is True and data.get("actualImagesViewed") is True and data.get("issues") == [],
            "Current visual review is missing, stale or unresolved")
    reviews = data.get("pdfs", []); count = 0
    require(len(reviews) == len(pdfs), "Each actual PDF needs a current graph-page visual review")
    for run, pdf, channel in pdfs:
        matches = [item for item in reviews if item.get("sha256") == pdf["sha256"] and item.get("path") == pdf["path"]]
        require(len(matches) == 1, "PDF visual review refers to another download")
        review = matches[0]; verify_item(review)
        render_item = {"path": review["renderResultsPath"], "sha256": review["renderResultsSha256"]}
        verify_item(render_item); rendered = load(render_item["path"])
        require(rendered["pdfSha256"] == pdf["sha256"] and artifact(rendered["pdf"])["path"] == pdf["path"],
                "Rendered visual evidence used another PDF")
        rendered_pages = {item["page"]: item for item in rendered["pages"]}
        require(set(rendered_pages) == set(range(1, pdf["pageCount"] + 1)), "PDF render page registry is incomplete")
        if scope == "sprint-display":
            graph_pages = {i + 1 for i, page in enumerate(run["pdf"]["pages"]) if any(
                chart["kind"] == "sprintFvp" for chart in page["charts"])}
            method_pages = {i + 1 for i, page in enumerate(run["pdf"]["pages"])
                            if "sprint-fvp-pointwise-delta-v1" in page["text"]}
            raw_pages = {i + 1 for i, page in enumerate(run["pdf"]["pages"])
                         if "原始录入分段" in page["text"] and "冲刺" in page["text"]}
            require(graph_pages and method_pages and raw_pages,
                    "Display PDF omitted its confidence graph, method or raw split pages")
            required = graph_pages | method_pages | raw_pages
        else:
            require(scope == "original-graphs", "Unknown visual review scope")
            required = {i + 1 for i, page in enumerate(run["pdf"]["pages"]) if any(
                chart["kind"] in ("jumpFvp", "jumpElasticity", "sprintFvp") for chart in page["charts"])}
        require(review["channel"] == channel and review["pageCount"] == pdf["pageCount"]
                and set(required) <= set(review["reviewedPages"]), "Targeted visual review omitted a current graph page")
        if data.get("allPagesVisuallyReviewed") is True:
            require(set(review["reviewedPages"]) == set(range(1, pdf["pageCount"] + 1)), "Full-page visual review claim exceeds actual coverage")
        images = review.get("reviewedImages", review.get("pages", []))
        require({item["page"] for item in images} == set(review["reviewedPages"])
                and all(item.get("actualImageViewed") is True for item in images), "Claimed PDF pages lack individual viewed PNGs")
        for item in images:
            verify_item(item)
            rendered_page = rendered_pages[item["page"]]
            require(artifact(rendered_page["png"])["path"] == artifact(item["path"])["path"]
                    and rendered_page["sha256"] == item["sha256"] and rendered_page["inkBounds"] is not None,
                    "Viewed PDF PNG differs from its render evidence or is blank")
        evidence["render:" + pdf["path"]] = artifact(render_item["path"])
        count += len(images)
    screenshots = data.get("screenshots", [])
    require(screenshots and {item["channel"] for item in screenshots} == set(CHANNELS)
            and all({item["width"] for item in screenshots if item["channel"] == channel} >= {1440, 390}
                    for channel in CHANNELS)
            and all(item.get("actualImageViewed") is True for item in screenshots), "Current responsive screenshots were not actually viewed")
    for item in screenshots:
        verify_item(item)
        candidates = [case for case in browser_cases if case["channel"] == item["channel"]
                      and case.get("width", item["width"]) == item["width"]]
        require(any(any(other["path"] == item["path"] and other["sha256"] == item["sha256"]
                        for other in case["artifacts"]) for case in candidates),
                "Reviewed screenshot is not bound to its current browser run")
    evidence["visual:" + relative] = artifact(relative)
    return {"pass": True, "actualImagesViewed": True, "pdfPagesViewed": count, "reviewScope": scope,
            "allPagesVisuallyReviewed": data.get("allPagesVisuallyReviewed") is True,
            "scope": "Current graph pages reviewed; other PDF pages covered by automated diagnostics unless individually listed",
            "screenshots": len(screenshots), "historicalFullPdfReviewIncludedInCurrentAcceptance": False,
            "limitations": data.get("limitations", [])}


def recheck_bindings(value):
    """Reject edits made while the evidence was being inspected."""
    if isinstance(value, dict):
        if "path" in value and "sha256" in value:
            verify_item(value)
        for child in value.values():
            recheck_bindings(child)
    elif isinstance(value, list):
        for child in value:
            recheck_bindings(child)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expect-sha", required=True)
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--unit-dir", default="output/tests/v2.17.5-sprint-display-final-v3")
    parser.add_argument("--browser-dir", default="output/playwright/sprint-display-2.17.5/final-v2-attempt-06")
    parser.add_argument("--graph-dir", default="output/playwright/fvp-three-regions/sprint-display-v2175-final-v2")
    parser.add_argument("--point-results", default="output/tests/v2.17.5-sprint-view/point-estimate-baseline-comparison.json")
    parser.add_argument("--existing-sprint-manifest", default="output/playwright/sprint-fvp-2.17.5-local/final-v2/execution-manifest.json")
    parser.add_argument("--science-results", default="output/verify/v2175-sprint-confidence-model-results.json")
    parser.add_argument("--scipy-results", default="output/verify/v2175-sprint-confidence-scipy-results.json")
    parser.add_argument("--visual-review", default="output/playwright/sprint-display-2.17.5/visual-review.json")
    parser.add_argument("--graph-visual-review", default="output/playwright/fvp-three-regions/sprint-display-v2175-final-v2/target-visual-review.json")
    args = parser.parse_args()
    require(re.fullmatch(r"[a-f0-9]{64}", args.expect_sha), "Expected frozen SHA must be 64 lowercase hex characters")
    evidence = {}; modules, contract = source_contract(args.expect_sha, evidence)
    units = verify_units(args.unit_dir, args.expect_sha, modules, evidence)
    points = verify_point_estimates(args.point_results, modules, evidence)
    science = verify_scientific_ci(args.science_results, args.scipy_results, modules, evidence)
    display, display_pdfs = verify_display(args.browser_dir, args.expect_sha, modules, evidence)
    graphs, graph_pdfs = verify_regions(args.graph_dir, args.expect_sha, evidence)
    existing = verify_existing_sprint(args.existing_sprint_manifest, args.expect_sha, evidence)
    visual = {"displayPdfReview": verify_visual(args.visual_review, args.expect_sha, display_pdfs, display, evidence, scope="sprint-display"),
              "originalGraphTargetedReview": verify_visual(args.graph_visual_review, args.expect_sha, graph_pdfs, graphs, evidence)}
    result = {"version": VERSION, "pass": True, "fullAcceptancePass": True, "localReviewable": True,
              "sourceHash": args.expect_sha, "sourceUnchanged": True, "synthetic": True,
              "verifiedAtUtc": datetime.now(timezone.utc).isoformat(), "sourceContract": contract,
              "modules": modules, "units": units, "pointEstimates": points, "confidenceScience": science,
              "displayBrowsers": display, "graphBrowsers": graphs, "existingSprintFlows": existing, "visualReview": visual,
              "storage2174AcceptanceIncluded": False, "realAthleteDataReadOrMigrated": False,
              "githubDeliveryVerified": False, "originalWindowsDeploymentVerified": False,
              "limitations": ["2.17.4 storage repair and capacity evidence are outside this UI release",
                              "Old unconditional storage writers and backup snapshot risks remain inherited from 2.17.3",
                              "Code rollback does not restore athlete data; no real user database was backed up or migrated"],
              "verifier": artifact("scripts/verify_v2175_sprint_display.py"), "evidence": evidence}
    recheck_bindings(result)
    require(all(digest(local_path("src/" + name)) == value for name, value in modules.items()),
            "An application module changed during verification")
    if not args.check_only:
        payload = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        for relative in (MANIFEST, PUBLIC):
            path = ROOT / relative; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(payload, encoding="utf-8")
    print(json.dumps({"pass": True, "fullAcceptancePass": True, "sourceHash": args.expect_sha,
                      "unitSuites": units["suiteCount"], "unitChecks": units["checks"],
                      "manifestWritten": not args.check_only,
                      "manifest": MANIFEST if not args.check_only else None}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, StopIteration, subprocess.CalledProcessError) as error:
        print(json.dumps({"pass": False, "fullAcceptancePass": False, "localReviewable": False,
                          "manifestWritten": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)
