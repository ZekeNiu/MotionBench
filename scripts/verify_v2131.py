"""Bind the 2.13.1 entry-flow acceptance to the exact offline delivery."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(relative):
    return json.loads((ROOT / relative).read_text(encoding="utf-8-sig"))


def descriptor(path):
    return {"path": path.relative_to(ROOT).as_posix(), "sha256": digest(path)}


def check_artifact(item):
    path = (ROOT / item["path"]).resolve()
    assert path.is_relative_to(ROOT) and path.is_file(), item
    assert digest(path) == (item.get("sha256") or item.get("hash")), item


def main():
    artifact = ROOT / "MotionBench.html"
    source_hash = digest(artifact)
    assert source_hash == digest(ROOT / "Ringside_Boxing_Assessment.html")
    assert load("package.json")["version"] == "2.13.1"
    html = artifact.read_text(encoding="utf-8")
    assert re.search(r'<script id="embedded-data" type="application/json">\s*null\s*</script>', html)
    source_modules = {p.relative_to(ROOT).as_posix(): digest(p) for p in sorted((ROOT / "src").glob("*")) if p.is_file()}
    subprocess.run([sys.executable, "scripts/build.py"], cwd=ROOT, check=True)
    assert digest(artifact) == source_hash == digest(ROOT / "Ringside_Boxing_Assessment.html"), "Build changed the tested delivery"
    for dep in load("vendor/versions.json")["dependencies"]:
        for file_key, hash_key in [("file", "sha256"), ("license_file", "license_sha256")]:
            assert digest(ROOT / "vendor" / dep[file_key]) == dep[hash_key]
    evidence, suites = {}, []

    def read(name, relative):
        data = load(relative)
        assert data["sourceHash"] == source_hash, f"Stale evidence: {relative}"
        evidence[name] = descriptor(ROOT / relative)
        return data

    units = read("unit", "output/tests/unit-results.json")
    assert len(units["suites"]) == 22
    assert all(s["exitCode"] == 0 and s["checksPassed"] > 0 for s in units["suites"])
    model_count = sum(s["checksPassed"] for s in units["suites"])
    pdf_count = 0
    for channel in ["chrome", "msedge"]:
        for name, directory, suffix in [
            ("Unified entry", "unified-entry", "results"),
            ("Excel", "v213-excel", "results"),
            ("Workflow", "refinement", "workflow"),
            ("Races", "refinement-races", "races"),
            ("Report toolbar", "report-toolbar", "results"),
            ("Isometric and PDF", "isometric-selection", "review"),
            ("Management", "management", "workflow"),
            ("Management resilience", "management", "resilience"),
            ("Management administration", "management", "admin"),
            ("Custom catalog", "unified-catalog", "browser"),
        ]:
            data = read(channel + name, f"output/playwright/{directory}/{channel}-{suffix}.json")
            assert data["pass"] and not data.get("errors") and not data.get("network"), data.get("failure")
            for key in ["images", "screenshots", "downloads"]:
                for item in data.get(key, []):
                    check_artifact(item)
            for layout in data.get("layouts", []):
                assert not any(layout.get(k) for k in ["overflow", "pageOverflow", "modalOverflow", "outside"]), layout
            for pdf in data.get("pdfs", []):
                check_artifact(pdf)
                assert pdf["diagnostics"]["status"] == "complete"
                assert not any(pdf["diagnostics"][k] for k in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"])
                assert all(not page["overflow"] for page in pdf["pages"])
                pdf_count += len(pdf["pages"])
            if name == "Excel":
                assert not data["exportPrivacy"]["containsOther"] and all(data["exportPrivacy"]["cleared"].values())
            suites.append({"name": channel + " " + name, "checks": len(data["checks"]), "pass": True})
    resilience = read("managementResilience", "output/playwright/management/resilience.json")
    assert resilience["pass"] and not resilience["errors"]
    entry_visual = read("entryVisual", "output/playwright/unified-entry/entry-acceptance.json")
    assert entry_visual["pass"] and entry_visual["visualReview"]["pass"]
    for item in entry_visual["visualReview"]["reviewed"]:
        check_artifact(item)
        assert item["pass"]
    native = load("output/excel-native/native-result.json")
    normal = load("output/excel-native/native-open-result.json")
    assert native["sourceSha256"] == normal["sourceSha256"] == source_modules["src/ringside-excel.js"]
    assert normal["artifactSha256"] == source_hash and normal["pass"] and normal["normalOpenCompleted"]
    assert normal["corruptLoad"] == 0 and normal["displayAlertsOnOpen"] and normal["protectedFilesUnchanged"]
    assert normal["inputSha256After"] == normal["inputSha256"]
    assert native["saved"] and native["format"] == 51
    assert digest(ROOT / "output/excel-native/template.xlsx") == native["inputSha256"] == normal["inputSha256"]
    assert digest(ROOT / "output/excel-native/excel-saved.xlsx") == native["outputSha256"]
    readback = load("output/excel-native/readback-result.json")
    assert readback["pass"] and readback["sourceHash"] == source_hash
    assert readback["xlsxHash"] == native["outputSha256"] and not readback["stderr"]
    assert int(re.search(r"(\d+) Excel model checks passed", readback["stdout"])[1]) == readback["checksPassed"]
    evidence["nativeReadback"] = descriptor(ROOT / "output/excel-native/readback-result.json")
    pdf_visual = load("output/playwright/isometric-selection/entry-v2131-pdf-visual.json")
    assert pdf_visual["pass"] and pdf_visual["sourceHash"] == source_hash
    evidence["pdfVisual"] = descriptor(ROOT / "output/playwright/isometric-selection/entry-v2131-pdf-visual.json")
    for image in pdf_visual.get("images", []):
        check_artifact(image)
        assert image["reviewed"] and image["visualPass"]
    assert len(pdf_visual["images"]) == pdf_count
    for pdf in pdf_visual["pdfs"]:
        check_artifact(pdf)
    assert sum(pdf["pages"] for pdf in pdf_visual["pdfs"]) == pdf_count
    summary = {
        "version": "2.13.1", "date": "2026-10-09", "pass": True,
        "artifact": descriptor(artifact), "sourceModules": source_modules,
        "modelChecks": model_count, "browserChecks": sum(s["checks"] for s in suites),
        "browserSuites": suites, "exportedPdfPages": pdf_count, "evidence": evidence,
        "pdfVisualReview": {"directlyInspectedPages": pdf_visual["manualPagesInspected"], "pixelEquivalentPages": pdf_visual["pixelEquivalentEdgePages"]},
        "nativeExcel": {"application": native["application"], "version": native["version"], "normalOpenPassed": True,
            "filledAndSaved": True, "inputSHA256": native["inputSha256"], "outputSHA256": native["outputSha256"], "readbackChecks": readback["checksPassed"]},
        "rollback": {"tag": "v2.13.0", "commit": "42d5c925d98b6faf64f19b8d491a724f733c8874", "htmlSHA256": "a5e025e02b5ed644c515a87841ae14cca841637f97de1f2d1c8a1c602a2fc07b"},
        "verificationLimits": [
            "All entry and workbook checks use synthetic people and measurements in isolated browsers.",
            "Layouts at 1440/1280/900/390 pixels are browser viewports, not physical mobile devices or printers.",
            "Microsoft Excel version is recorded above; other spreadsheet applications are not verified.",
            "Live AI providers and physical measurement devices were not revalidated.",
            "The previous Chrome approximately 570 MB / 3000-record backup stress cancellation remains unresolved and was not rerun in this flow-only release; v2.13.0 records its old-baseline reproduction and successful Edge entity roundtrip. This capacity case is not claimed as passed."
        ],
    }
    (ROOT / "docs/acceptance-2.13.1.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"htmlSHA256": source_hash, "modelChecks": model_count, "browserChecks": summary["browserChecks"], "exportedPdfPages": pdf_count}, ensure_ascii=False))


if __name__ == "__main__":
    main()
