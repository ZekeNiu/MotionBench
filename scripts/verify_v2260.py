"""Bind the local 2.26.0 HTML to completed tests and inspected PDF images."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/horizontal-refinement/acceptance"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(relative):
    return json.loads((ROOT / relative).read_text(encoding="utf-8-sig"))


def verify():
    version = read("package.json")["version"]
    assert version == "2.26.0"
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
        else:
            assert value.get("pass") is True and not value.get("errors"), relative
            rows = value["checks"]
            assert len(rows) >= minimum, relative
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

    unit = receipt("output/horizontal-refinement/acceptance/unit/unit-results.json", "tests/run-unit-tests.cjs", 76, True)
    receipt("output/horizontal-refinement/acceptance/desktop-unit/results.json", "tests/run-desktop-unit-tests.cjs", 5, True)
    for channel in ["chrome", "msedge"]:
        receipt(f"output/playwright/horizontal-refinement/{channel}/result.json", "tests/horizontal-refinement-browser-tests.cjs", 15)
        receipt(f"output/playwright/horizontal-refinement-copy/{channel}/result.json", "tests/horizontal-refinement-copy-tests.cjs", 8)
        receipt(f"output/playwright/horizontal-classification-ui/result-{channel}.json", "tests/horizontal-classification-ui-tests.cjs", 10)
    multi = receipt("output/playwright/horizontal-refinement/multiperson/results.json", "tests/horizontal-multiperson-pdf-tests.cjs", 7)
    presentation = receipt("output/playwright/horizontal-refinement/presentation/results.json", "tests/horizontal-presentation-browser-tests.cjs", 4)
    assert multi["headerBounds"] == {"desktop": True, "narrow": True, "nativePrint": True}, "Long athlete names exceed their table cells"
    for key, filename in [("pdf", "eight-athletes.pdf"), ("groupOnlyPdf", "group-only.pdf"), ("nativePdf", "browser-print.pdf")]:
        assert multi[key]["sha256"] == digest(ROOT / "output/playwright/horizontal-refinement/multiperson" / filename), filename
    assert presentation["pdf"]["sha256"] == digest(ROOT / "output/playwright/horizontal-refinement/presentation/three-people-screening.pdf")
    layout = presentation["groupLayout"]
    assert layout["bodyImage"] and layout["desktopColumns"] == 2 and layout["narrowColumns"] == 1 and layout["fakeRecords"] == 0
    assert set(layout["isoSections"]) == {"force", "asymmetry", "balance"}
    visual = read("output/horizontal-refinement/acceptance/visual-review.json")
    assert visual["sourceHash"] == source_hash and visual["pass"] is True
    assert len(visual["artifacts"]) >= 6
    for item in visual["artifacts"]:
        assert digest(ROOT / item["file"]) == item["sha256"], item["file"]
    evidence.append({"file": "output/horizontal-refinement/acceptance/visual-review.json", "sha256": digest(OUT / "visual-review.json")})
    result = {
        "pass": True, "version": version, "scope": "local standalone HTML; isolated browser and dated data-copy acceptance",
        "artifact": {"file": "MotionBench.html", "sha256": source_hash, "bytes": html.stat().st_size},
        "unitSuites": len(unit["suites"]), "unitChecks": sum(row.get("checksPassed", 0) for row in unit["suites"]),
        "evidence": evidence,
        "boundaries": ["No installed application or live user profile was changed.", "Data-copy source is the Explorer-backed backup dated 2026-10-22.", "No installer, publication, or external AI-provider acceptance is claimed."],
    }
    target = OUT / "acceptance.json"
    if "--write" in sys.argv:
        target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        assert read(str(target.relative_to(ROOT))) == result, "Acceptance manifest differs; recheck the final inputs"
    print(json.dumps({"pass": True, "version": version, "sha256": source_hash, "suites": result["unitSuites"], "checks": result["unitChecks"]}))


if __name__ == "__main__":
    verify()
