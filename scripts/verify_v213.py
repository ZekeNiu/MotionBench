"""Verify MotionBench 2.13.0 evidence against the frozen offline delivery."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_HTML = "a5e025e02b5ed644c515a87841ae14cca841637f97de1f2d1c8a1c602a2fc07b"
EXPECTED_ENTITIES = {"config": 1, "group": 10, "profile": 1, "athlete": 300, "record": 3000}


def digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def local_path(value):
    path = (ROOT / value).resolve()
    assert path.is_relative_to(ROOT), f"Evidence path outside workspace: {value}"
    assert path.is_file(), f"Missing evidence file: {value}"
    return path


def descriptor(path):
    return {"path": path.relative_to(ROOT).as_posix(), "sha256": digest(path)}


def load(relative):
    return json.loads(local_path(relative).read_text(encoding="utf-8-sig"))


def check_file(item):
    path = local_path(item["path"])
    assert digest(path) == (item.get("sha256") or item["hash"]), f"Changed file: {item['path']}"


def backup_entities(path):
    checksum, counts = hashlib.sha256(), {}
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            if row["type"] in {"header", "end"}:
                continue
            counts[row["type"]] = counts.get(row["type"], 0) + 1
            checksum.update(json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    return {"sha256": checksum.hexdigest(), "counts": counts}


def main():
    artifact = ROOT / "MotionBench.html"
    source_hash = digest(artifact)
    assert source_hash == EXPECTED_HTML == digest(ROOT / "Ringside_Boxing_Assessment.html"), "Delivery differs from frozen candidate"
    assert load("package.json")["version"] == "2.13.0"
    html = artifact.read_text(encoding="utf-8")
    assert re.search(r'<script id="embedded-data" type="application/json">\s*null\s*</script>', html), "Delivery contains embedded athlete data"
    source_modules = {p.relative_to(ROOT).as_posix(): digest(p) for p in sorted((ROOT / "src").glob("*")) if p.is_file()}
    for path in (ROOT / "src").glob("*.css"):
        assert path.read_text(encoding="utf-8") in html, f"Styles missing from delivery: {path.name}"
    vendor = load("vendor/versions.json")
    vendor_files = []
    for dependency in vendor["dependencies"]:
        for file_key, hash_key in [("file", "sha256"), ("license_file", "license_sha256")]:
            path = local_path("vendor/" + dependency[file_key])
            assert digest(path) == dependency[hash_key], f"Pinned dependency changed: {path.name}"
            vendor_files.append(descriptor(path))
    build = subprocess.run([sys.executable, "scripts/build.py"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
    assert digest(artifact) == source_hash == digest(ROOT / "Ringside_Boxing_Assessment.html"), "Build is not reproducible"
    assert source_modules == {p.relative_to(ROOT).as_posix(): digest(p) for p in sorted((ROOT / "src").glob("*")) if p.is_file()}, "Sources changed while verifying"
    evidence = {}

    def read(name, relative, *, picker=False):
        data = load(relative)
        assert data["artifactHash" if picker else "sourceHash"] == source_hash, f"Stale evidence: {relative}"
        if picker:
            assert data["sourceHash"] == source_modules["src/ringside-picker.js"], "Picker evidence has stale component source"
        evidence[name] = descriptor(local_path(relative))
        return data

    def clean(data):
        assert data["pass"] and not data.get("errors") and not data.get("network"), data.get("failure", "Failed evidence")
        for key in ["images", "screenshots", "downloads"]:
            for item in data.get(key, []):
                check_file(item)
        for layout in data.get("layouts", []):
            for key in ["overflow", "pageOverflow", "modalOverflow", "overflows", "misordered", "outside"]:
                assert not layout.get(key), f"Layout failure: {key}"
        for pdf in data.get("pdfs", []):
            check_file(pdf)
            assert pdf["diagnostics"]["status"] == "complete"
            for key in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
                assert not pdf["diagnostics"][key], f"PDF failure: {key}"
            assert all(not page["overflow"] for page in pdf["pages"])

    unit = read("unit", "output/tests/unit-results.json")
    assert len(unit["suites"]) == 21 and len({suite["name"] for suite in unit["suites"]}) == 21
    for suite in unit["suites"]:
        assert suite["exitCode"] == 0 and suite["checksPassed"] > 0, suite["name"]
        match = re.search(r"(\d+) [^\n]*checks passed", suite["stdout"])
        assert match and int(match[1]) == suite["checksPassed"], suite["name"]
    model_checks = sum(suite["checksPassed"] for suite in unit["suites"])
    browser_checks, browser_suites = 0, []
    for channel in ["chrome", "msedge"]:
        for name, directory, suffix, minimum in [
            ("Excel", "v213-excel", "results", 15),
            ("Toolbar", "report-toolbar", "results", 8),
            ("Management", "management-refinement", "browser", 8),
            ("Workflow", "refinement", "workflow", 10),
            ("Races", "refinement-races", "races", 5),
            ("Isometric", "isometric-selection", "review", 6),
            ("Picker", "picker", "results", 5),
        ]:
            relative = f"output/playwright/{directory}/{channel}-{suffix}.json"
            data = read(channel + name, relative, picker=name == "Picker")
            clean(data)
            assert data["channel"] == channel and len(data["checks"]) >= minimum, relative
            if name == "Isometric":
                assert data["sourceUnchanged"]
            if name == "Excel":
                assert not data["exportPrivacy"]["containsOther"] and all(data["exportPrivacy"]["cleared"].values())
            browser_checks += len(data["checks"])
            browser_suites.append({"name": channel + name, "checks": len(data["checks"]), "pass": True})
    resilience = read("managementResilience", "output/playwright/management/resilience.json")
    clean(resilience)
    assert len(resilience["checks"]) >= 13
    browser_checks += len(resilience["checks"])
    browser_suites.append({"name": "managementResilience", "checks": len(resilience["checks"]), "pass": True})

    visual = read("pdfVisual", "output/playwright/isometric-selection/pdf-review.json")
    assert visual["pass"] and len(visual["pdfs"]) == 4
    check_file(visual["baselineReview"])
    baseline = load(visual["baselineReview"]["path"])
    total_pages = 0
    for pdf in visual["pdfs"]:
        assert pdf["sourceHash"] == source_hash and pdf["pass"] and pdf["paginationPass"]
        check_file({"path": pdf["pdf"], "hash": pdf["hash"]})
        assert pdf["totalPages"] == len(pdf["renderedPages"])
        assert pdf["reviewedPages"] == list(range(1, pdf["totalPages"] + 1))
        reference = baseline["fullPdf"] if pdf["name"] == "ten-region" else baseline["sparsePdf"]
        assert len(reference["pages"]) == pdf["totalPages"]
        for page in pdf["renderedPages"]:
            check_file(page)
            reference_page = reference["pages"][page["page"] - 1]
            assert page["reviewed"] and reference_page["visualPass"]
            assert page["hash"] == page["baselineImageHash"] == reference_page["sha256"]
            assert page["baselineSourceHash"] == reference["sourceHash"]
            check_file({"path": page["baselineImage"], "hash": page["baselineImageHash"]})
        total_pages += pdf["totalPages"]
    assert total_pages == visual["reviewedPages"] == visual["totalPages"] == 36
    screen = visual["screenReview"]
    assert screen["pass"] and screen["sourceHash"] == source_hash and len(screen["images"]) == 4
    for image in screen["images"]:
        assert image["pass"]
        check_file(image)

    native = load("output/excel-native/native-result.json")
    native_open = load("output/excel-native/native-open-result.json")
    assert native_open.get("pass") and native_open.get("normalOpenCompleted"), native_open.get("error", "Native Excel normal opening has not passed")
    native_source = source_modules["src/ringside-excel.js"]
    assert native["sourceSha256"] == native_open["sourceSha256"] == native_source
    assert native["application"] == native_open["application"] == "Microsoft Excel"
    assert native["saved"] and native["format"] == 51 and native["sheetCount"] == len(native["sheets"])
    assert digest(local_path(native["input"])) == native["inputSha256"]
    assert digest(local_path(native["output"])) == native["outputSha256"]
    assert native_open["pass"] and native_open["normalOpenCompleted"] and native_open["artifactSha256"] == source_hash
    assert native_open["displayAlertsOnOpen"] and native_open["readOnlyOnOpen"] and native_open["savedOriginalOnOpen"]
    assert native_open["corruptLoad"] == 0 and native_open["visibleOnOpen"] is False
    assert native_open["fileFormat"] == 51 and native_open["sheetCount"] == len(native_open["sheets"]) == native["sheetCount"]
    assert native_open["inputSha256"] == native_open["inputSha256After"] == digest(local_path(native_open["input"]))
    assert native_open["inputSha256"] == native["inputSha256"]
    assert native_open["ownedExcelPid"] > 0 and native_open["ownedExcelPid"] not in native_open["preexistingExcelPids"]
    evidence["nativeExcelSave"] = descriptor(local_path("output/excel-native/native-result.json"))
    evidence["nativeExcelNormalOpen"] = descriptor(local_path("output/excel-native/native-open-result.json"))
    native_command = ["node", "tests/excel-model-tests.cjs", "--verify-native"]
    parsed = subprocess.run(native_command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
    native_match = re.search(r"\b(\d+) Excel model checks passed\b", parsed.stdout)
    assert native_match, "Native Excel parser check summary missing"
    native_checks = int(native_match[1])
    excel_model_checks = next(suite["checksPassed"] for suite in unit["suites"] if suite["name"] == "excel-model-tests.cjs")
    assert native_checks >= 22 and native_checks == excel_model_checks + 1, "Expected the complete Excel model suite and one native-save check"
    assert "PASS native Microsoft Excel save can be parsed and measured values match" in parsed.stdout
    native_excel = {
        "pass": True, "application": native["application"], "version": native["version"],
        "sourceSha256": native_source, "artifactSha256": source_hash,
        "input": descriptor(local_path(native["input"])), "output": descriptor(local_path(native["output"])),
        "seed": descriptor(local_path("output/excel-native/native-seed.json")),
        "normalOpenWithAlerts": True, "repairMode": False,
        "parserVerification": {"command": native_command, "exitCode": parsed.returncode, "checksPassed": native_checks, "stdout": parsed.stdout, "stderr": parsed.stderr},
        "countingNote": f"{native_checks} checks rerun independently against the native Excel-saved workbook; the existing {excel_model_checks} Excel model checks are already included in modelChecks.",
    }

    chrome_limitation = read("chromeCapacityLimitation", "output/playwright/management/chrome-capacity-limitation.json")
    assert chrome_limitation["status"] == "not_passed"
    assert chrome_limitation["current"]["sourceHash"] == source_hash
    assert chrome_limitation["baseline"]["sourceHash"] == load("docs/acceptance-2.12.0.json")["sha256"]
    for failed in [chrome_limitation["current"], chrome_limitation["baseline"]]:
        assert not failed["pass"] and failed["channel"] == "chrome" and failed["athletes"] == 300 and failed["records"] == 3000
        assert "download.saveAs: canceled" in failed["failure"]
    capacity = [{"channel": "chrome", "pass": False, "status": "Additional stress case not accepted", "athletes": 300, "records": 3000,
                 "failure": "Approximately 570 MB backup download canceled; cause unknown.", "observations": chrome_limitation["observations"]}]
    for channel in ["msedge"]:
        data = read(channel + "Capacity", f"output/playwright/management/{channel}-capacity.json")
        assert data["channel"] == channel and data["athletes"] == 300 and data["records"] == 3000 and data["synthetic"]
        clean(data)
        assert data["allEntitiesExact"] and data["abilityExtensionRoundtrip"]
        assert data["before"] == data["after"] and data["before"]["count"] == 3000
        backups = []
        for suffix in ["capacity", "capacity-restored"]:
            path = local_path(f"output/playwright/management/{channel}-{suffix}.motionbench.jsonl")
            entities = backup_entities(path)
            assert entities == data["allEntitiesRoundtrip"] and entities["counts"] == EXPECTED_ENTITIES
            backups.append({**descriptor(path), "bytes": path.stat().st_size, "entities": entities})
        assert backups[0]["bytes"] == data["backupBytes"] and data["backupBytes"] > 50 * 1024 * 1024
        timings = data["timings"]
        assert max(timings["startupMs"]) <= 3000 and max(timings["searchMs"]) <= 300 and timings["openMs"] <= 1000 and timings["saveMs"] <= 1000
        capacity.append({"channel": channel, "pass": True, "athletes": 300, "records": 3000, "allEntitiesExact": True, "backups": backups, "timings": timings})

    assert digest(artifact) == source_hash, "Delivery changed during verification"
    limits = [
        "Synthetic measurements and isolated Chrome/Edge profiles; no personal athlete records used.",
        "Mobile layouts were checked with browser viewports, not physical phones, measurement devices or printers.",
        "Online AI provider behavior and live model response quality were not revalidated in this release.",
        "Native workbook checks used the installed Microsoft Excel version reported in nativeExcel; other spreadsheet applications were not verified.",
        "New joint directions do not introduce clinical norms or training efficacy claims; targets remain user-configured.",
        "The additional Chrome 300-athlete/3000-record stress case did not pass: the approximately 570 MB backup download was canceled. A v2.12.0 baseline and delayed-URL-revocation diagnostic also failed, but the cause remains unknown; this does not establish absence of a regression. Edge completed the same capacity backup/restore with every entity verified. Chrome stress is not counted among successful browser checks.",
    ]
    rollback = load("docs/acceptance-2.12.0.json")
    result = {
        "pass": True, "version": "2.13.0", "html": artifact.name, "sha256": source_hash, "bytes": artifact.stat().st_size,
        "acceptanceScope": "Offline Excel template/import and native workbook roundtrip; shared grouped test picker; 42 isometric directions across ten regions; record/plan compatibility; report toolbar; selected-data statistics, AI facts, charts and actual PDF; persistence, backups and documented capacity results.",
        "cleanEmbeddedData": True, "reproducibleBuild": True, "buildStdout": build.stdout,
        "sourceModules": source_modules, "vendorManifest": descriptor(local_path("vendor/versions.json")), "verifiedVendorFiles": vendor_files,
        "externalAssets": [descriptor(local_path("body-map-front.png"))],
        "evidence": evidence, "modelChecks": model_checks, "modelSuites": len(unit["suites"]),
        "browserChecks": browser_checks, "browserSuites": browser_suites,
        "nativeExcel": native_excel, "pdfPagesVisuallyReviewed": total_pages,
        "capacity": capacity, "capacityFullyAccepted": all(item["pass"] for item in capacity),
        "additionalStressChromePassed": False,
        "rollback": {"tag": "v2.12.0", "htmlSHA256": rollback["sha256"]},
        "verificationLimits": limits,
    }
    destination = ROOT / "docs/acceptance-2.13.0.json"
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"PASS 2.13.0: {model_checks} model checks across 21 suites; {browser_checks} browser checks; {native_checks} independent native Excel parser checks; {total_pages} PDF pages")
    print(f"Capacity fully accepted: {result['capacityFullyAccepted']}")
    print(source_hash)


if __name__ == "__main__":
    main()
