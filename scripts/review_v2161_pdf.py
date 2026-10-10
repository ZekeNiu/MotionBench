"""Render the actual 2.16.1 downloaded PDFs and bind visual review to their hashes."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import review_fvp_pdf as review

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "output/playwright/report-v2161"
review.RENDERS = ROOT / "output/pdf/rendered/report-v2161"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manual-review", "--review", dest="manual_review", type=Path)
    parser.add_argument("--dpi", type=int, default=110)
    args = parser.parse_args()
    inspections = json.loads(args.manual_review.read_text(encoding="utf-8")) if args.manual_review else None
    source_hash = review.sha256(ROOT / "MotionBench.html")
    cases, browser_results = [], []
    executable = review.poppler_path()
    for channel in ("chrome", "msedge"):
        manifest = RESULTS / f"{channel}-results.json"
        browser = json.loads(manifest.read_text(encoding="utf-8"))
        assert browser["pass"] and browser["sourceHash"] == source_hash and browser["sourceUnchanged"], "Browser evidence is stale or failed"
        browser_results.append({"path": review.relative(manifest), "sha256": review.sha256(manifest)})
        for pdf in browser["pdfs"]:
            case = review.review_case(pdf, browser, executable, args.dpi)
            case["checkedCells"] = sum(page.get("cellCount", 0) for page in pdf["pages"])
            case["cellBoundsPass"] = case["checkedCells"] > 0 and all("cellOverflow" in page and not page["cellOverflow"] for page in pdf["pages"])
            assert case["cellBoundsPass"], "PDF text or badge crosses a table-cell boundary"
            if inspections:
                inspected = next(item for item in inspections["cases"] if item["channel"] == case["channel"] and item["name"] == case["name"])
                assert inspected["sourceHash"] == source_hash and inspected["pdfSha256"] == case["pdfSha256"], "Visual evidence is stale"
                assert set(inspected["reviewedPages"]) == {page["image"] for page in case["pageChecks"]}, "Every PDF page must be reviewed"
                assert inspected["pass"] is True
                case["manualReview"] = inspected
            cases.append(case)
    page_checks = [page for case in cases for page in case["pageChecks"]]
    reviewed_pages = [page for case in (inspections or {}).get("cases", []) for page in case["reviewedPages"]]
    artifacts = [{"path": case["pdf"], "sha256": case["pdfSha256"]} for case in cases]
    artifacts.extend({"path": page["image"], "sha256": page["imageSha256"]} for page in page_checks)
    artifacts.extend({"path": contact, "sha256": review.sha256(ROOT / contact)} for case in cases for contact in case["contactSheets"])
    if args.manual_review:
        artifacts.append({"path": review.relative(args.manual_review.resolve()), "sha256": review.sha256(args.manual_review)})
    evidence = {"sourceHash": source_hash, "browserResults": browser_results,
                "a4": all(page["a4"] for page in page_checks), "nonempty": all(page["bodyNonblank"] for page in page_checks),
                "pageCount": len(page_checks), "outerEdgesClear": all(page["outerEdgesClear"] for page in page_checks),
                "cellBounds": {"pass": all(case["cellBoundsPass"] for case in cases), "checkedCells": sum(case["checkedCells"] for case in cases)},
                "automatedPass": all(case["automatedPass"] for case in cases),
                "visualReview": {"pass": inspections is not None and len(reviewed_pages) == len(page_checks), "reviewedPages": reviewed_pages},
                "cases": cases, "artifacts": artifacts}
    evidence["pass"] = evidence["automatedPass"] and evidence["visualReview"]["pass"]
    destination = RESULTS / "pdf-render-results.json"
    destination.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"path": review.relative(destination), "sourceHash": source_hash, "pageCount": len(page_checks), "automatedPass": evidence["automatedPass"], "pass": evidence["pass"]}))


if __name__ == "__main__":
    main()
