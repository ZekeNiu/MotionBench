"""Bind the local 2.26.2 HTML to completed tests and inspected PDF images."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/release/2.26.2-local/acceptance"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(relative):
    return json.loads((ROOT / relative).read_text(encoding="utf-8-sig"))


def verify():
    version = read("package.json")["version"]
    assert version == "2.26.2"
    html = ROOT / "MotionBench.html"
    source_hash = digest(html)
    evidence = []

    def receipt(relative, runner, minimum, suites=False):
        value = read(relative)
        assert value["sourceHash"] == source_hash, f"Stale HTML receipt: {relative}"
        assert value["runnerSha256"] == digest(ROOT / runner), f"Changed test runner: {runner}"
        if suites:
            assert value.get("sourceUnchanged") is True, relative
            rows = value["suites"]
            assert len(rows) >= minimum and all(row["exitCode"] == 0 and row.get("sourceUnchanged") is True for row in rows), relative
            for row in rows:
                assert digest(ROOT / "tests" / row["name"]) == row["sha256"], row["name"]
                if "log" in row:
                    log = (ROOT / row["log"]).resolve()
                    assert log.is_relative_to(ROOT.resolve()) and digest(log) == row["logSha256"], row["log"]
        else:
            assert value.get("pass") is True and not value.get("errors"), relative
            rows = value["checks"]
            assert len(rows) >= minimum, relative
        if "selectionUiHelperSha256" in value:
            assert value["selectionUiHelperSha256"] == digest(ROOT / "tests/helpers/report-selection-ui.cjs")
        for key, base in [("modules", "src"), ("moduleHashes", ""), ("runtimeHashes", "")]:
            for name, expected in value.get(key, {}).items():
                assert digest(ROOT / base / name) == expected, name
        for item in value.get("artifacts", []):
            path = Path(item.get("path") or item.get("file"))
            if not path.is_absolute():
                path = ROOT / path
            assert digest(path) == item["sha256"], str(path)
        if "backupSourceHashAfter" in value:
            assert value["backupHash"] == value["backupSourceHashAfter"] == digest(Path(value["backupSource"])), "Original backup changed"
            assert value["candidateNumericHashes"] == value["publishedNumericHashes"], "Personal/longitudinal baseline differs"
        evidence.append({"file": relative, "sha256": digest(ROOT / relative), "checks": len(rows)})
        return value

    unit = receipt("output/release/2.26.2-local/acceptance/unit-final/unit-results.json", "tests/run-unit-tests.cjs", 80, True)
    receipt("output/release/2.26.2-local/acceptance/desktop-unit/results.json", "tests/run-desktop-unit-tests.cjs", 5, True)
    for channel in ["chrome", "msedge"]:
        receipt(f"output/playwright/horizontal-appearance/{channel}/results.json", "tests/horizontal-appearance-browser-tests.cjs", 7)
        receipt(f"output/playwright/report-appearance/{channel}/results.json", "tests/report-appearance-browser-tests.cjs", 6)
        relative = f"output/playwright/personal-appearance/{channel}/results.json"
        component = read(relative)
        assert component["pass"] and component["sourceUnchanged"] and not component["errors"]
        assert component["runnerSha256"] == digest(ROOT / "tests/personal-report-appearance-browser-tests.cjs")
        assert len(component["checks"]) >= 36
        for name, expected in component["sourceHashes"].items():
            assert digest(ROOT / name) == expected, name
            assert (ROOT / name).read_text(encoding="utf-8") in html.read_text(encoding="utf-8"), "Component source is not embedded in final HTML: " + name
        for item in component["screenshots"]:
            assert digest(ROOT / item["path"]) == item["sha256"], item["path"]
        evidence.append({"file": relative, "sha256": digest(ROOT / relative), "checks": len(component["checks"]), "scope": "Native component SVG geometry and scoped export containers; module hashes bound to rebuilt HTML"})
    for channel in ["chrome", "msedge"]:
        receipt(f"output/playwright/horizontal-refinement/{channel}/result.json", "tests/horizontal-refinement-browser-tests.cjs", 16)
        receipt(f"output/playwright/horizontal-refinement-copy/{channel}/result.json", "tests/horizontal-refinement-copy-tests.cjs", 8)
        receipt(f"output/playwright/horizontal-classification-ui/result-{channel}.json", "tests/horizontal-classification-ui-tests.cjs", 10)
    for channel in ["chrome", "msedge"]:
        receipt(f"output/playwright/horizontal-storage/result-{channel}.json", "tests/horizontal-storage-browser-tests.cjs", 19)
    for channel in ["chrome", "msedge"]:
        receipt(f"output/playwright/report-selection-edge-cases/result-{channel}.json", "tests/report-selection-edge-cases-browser-tests.cjs", 9)
    scale = receipt("output/playwright/horizontal-scale/result-chrome.json", "tests/horizontal-scale-browser-tests.cjs", 10)
    failure = read("output/release/2.26.2-local/native-failure-tests/results.json")
    assert failure["pass"] is True and len(failure["checks"]) == 2 and failure["sourceHash"] == source_hash
    assert failure["runnerSha256"] == digest(ROOT / "tests/native-runner-failure-tests.cjs")
    assert failure["helperSha256"] == digest(ROOT / "tests/helpers/native-runner-limits.cjs")
    assert failure["childSha256"] == digest(ROOT / "tests/helpers/native-runner-failure-child.cjs")
    evidence.append({"file": "output/release/2.26.2-local/native-failure-tests/results.json", "sha256": digest(ROOT / "output/release/2.26.2-local/native-failure-tests/results.json"), "checks": 2})
    native = receipt("output/horizontal-refinement/native-2.26.2/results.json", "tests/horizontal-refinement-native-tests.cjs", 11)
    package = read("output/release/2.26.2-local/package-check.json")
    assert package["version"] == "2.26.2-desktop.1" and package["webVersion"] == version
    archive = ROOT / "output/release/2.26.2-local/desktop/win-unpacked/resources/app.asar"
    assert package["archiveSha256"] == digest(archive) == native["identity"]["archiveSha256"]
    assert native["identity"]["sourceHtmlSha256"] == native["identity"]["runtimeHtmlSha256"] == source_hash
    for name, expected in native.get("supportingHelpers", {}).items():
        assert digest(ROOT / "tests/helpers" / name) == expected, name
    smoke_path = "output/release/2.26.2-local/native-smoke/results.json"
    smoke = read(smoke_path)
    assert smoke["pass"] is True and not smoke["errors"] and len(smoke["checks"]) >= 16
    assert smoke["identity"]["archiveSha256"] == package["archiveSha256"]
    assert smoke["identity"]["runtimeHtmlSha256"] == source_hash
    assert smoke["identity"]["testScriptSha256"] == digest(ROOT / "tests/desktop-smoke.cjs")
    for item in smoke.get("artifacts", []):
        assert digest(ROOT / "output/release/2.26.2-local/native-smoke" / item["path"]) == item["sha256"]
    evidence.append({"file": smoke_path, "sha256": digest(ROOT / smoke_path), "checks": len(smoke["checks"])})
    multi = receipt("output/playwright/horizontal-refinement/multiperson/results.json", "tests/horizontal-multiperson-pdf-tests.cjs", 7)
    presentation = receipt("output/playwright/horizontal-refinement/presentation/results.json", "tests/horizontal-presentation-browser-tests.cjs", 4)
    assert multi["headerBounds"] == {"desktop": True, "narrow": True, "nativePrint": True}, "Long athlete names exceed their table cells"
    for key, filename in [("pdf", "eight-athletes.pdf"), ("groupOnlyPdf", "group-only.pdf"), ("nativePdf", "browser-print.pdf")]:
        assert multi[key]["sha256"] == digest(ROOT / "output/playwright/horizontal-refinement/multiperson" / filename), filename
    assert presentation["pdf"]["sha256"] == digest(ROOT / "output/playwright/horizontal-refinement/presentation/three-people-screening.pdf")
    layout = presentation["groupLayout"]
    assert layout["bodyImage"] and layout["desktopColumns"] == 2 and layout["narrowColumns"] == 1 and layout["fakeRecords"] == 0
    assert set(layout["isoSections"]) == {"force", "asymmetry", "balance"}
    visual = read("output/release/2.26.2-local/acceptance/visual-review.json")
    assert visual["sourceHash"] == source_hash and visual["pass"] is True
    assert len(visual["artifacts"]) >= 6
    for item in visual["artifacts"]:
        assert digest(ROOT / item["file"]) == item["sha256"], item["file"]
    evidence.append({"file": "output/release/2.26.2-local/acceptance/visual-review.json", "sha256": digest(OUT / "visual-review.json")})
    result = {
        "pass": True, "version": version, "scope": ["Approved ink-teal report appearance, stable date and athlete colors, and comparison layout", "Final HTML calculation, Chrome and Edge selection, storage and dated-copy workflows", "Rendered PDF and native packaged report export, reopen and desktop checks"],
        "artifact": {"file": "MotionBench.html", "sha256": source_hash, "bytes": html.stat().st_size},
        "unitSuites": len(unit["suites"]), "unitChecks": sum(row.get("checksPassed", 0) for row in unit["suites"]),
        "evidence": evidence,
        "desktopVersion": "2.26.2-desktop.1",
        "package": {"archiveSha256": digest(archive), "assets": len(package["files"]),
                    "installerSha256": digest(ROOT / "output/release/2.26.2-local/desktop/MotionBench-2.26.2-desktop.1-Setup-x64.exe"),
                    "portableSha256": digest(ROOT / "output/release/2.26.2-local/desktop/MotionBench-2.26.2-desktop.1-Portable-x64.exe")},
        "boundaries": ["Synthetic desktop profiles and isolated dated-data copies; real installation verification is retained locally.", "No external AI-provider or physical-printer acceptance is claimed."],
    }
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / "acceptance.json"
    if "--write" in sys.argv:
        target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        assert read(str(target.relative_to(ROOT))) == result, "Acceptance manifest differs; recheck the final inputs"
    print(json.dumps({"pass": True, "version": version, "sha256": source_hash, "suites": result["unitSuites"], "checks": result["unitChecks"]}))


if __name__ == "__main__":
    verify()
