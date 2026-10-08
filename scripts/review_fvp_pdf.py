"""Render actual FVP browser PDFs; keep automated and manual review evidence separate."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

from PIL import Image, ImageChops, ImageDraw
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "output/playwright/fvp"
RENDERS = ROOT / "output/pdf/rendered/fvp"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def relative(path: Path) -> str:
    return path.resolve().relative_to(ROOT.resolve()).as_posix()


def poppler_path() -> str:
    executable = os.environ.get("RINGSIDE_PDFTOPPM") or shutil.which("pdftoppm")
    bundled = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe"
    if not executable and bundled.is_file():
        executable = str(bundled)
    if not executable:
        raise SystemExit("Set RINGSIDE_PDFTOPPM to pdftoppm, or install Poppler.")
    return executable


def raster_check(image_path: Path, page_number: int) -> dict:
    image = Image.open(image_path).convert("RGB")
    grayscale = ImageChops.difference(image, Image.new("RGB", image.size, "white")).convert("L")
    threshold = grayscale.point(lambda value: 255 if value > 25 else 0)
    # Repeating header/footer cannot hide an empty report body.
    body_box = (40, 100, image.width - 40, image.height - 90)
    body = threshold.crop(body_box)
    body_ink = body.histogram()[255]
    edge_boxes = [(0, 0, 15, image.height), (image.width - 15, 0, image.width, image.height),
                  (0, 0, image.width, 15), (0, image.height - 15, image.width, image.height)]
    edge_ink = sum(threshold.crop(box).histogram()[255] for box in edge_boxes)
    return {"page": page_number, "image": relative(image_path), "imageSha256": sha256(image_path),
            "pixelSha256": hashlib.sha256(image.tobytes()).hexdigest(), "pixels": list(image.size),
            "inkBoundsPixels": threshold.getbbox(), "bodyCropPixels": body_box,
            "bodyInkBoundsPixels": body.getbbox(), "bodyInkPixels": body_ink,
            "bodyInkRatio": round(body_ink / (body.width * body.height), 6),
            "outer15pxInkPixels": edge_ink, "bodyNonblank": body_ink > 100,
            "outerEdgesClear": edge_ink == 0}


def make_contacts(images: list[Path], folder: Path, title: str) -> list[str]:
    contacts = []
    for first in range(0, len(images), 6):
        sheet = Image.new("RGB", (1260, 1230), "#edf0f4")
        draw = ImageDraw.Draw(sheet)
        for offset, image_path in enumerate(images[first:first + 6]):
            page = Image.open(image_path).convert("RGB")
            page.thumbnail((400, 566))
            x, y = (offset % 3) * 420 + 10, (offset // 3) * 610 + 30
            draw.text((x, y - 20), f"{title}  page {first + offset + 1}", fill="#202b3b")
            sheet.paste(page, (x, y))
        destination = folder / f"contact-{first // 6 + 1}.png"
        sheet.save(destination)
        contacts.append(relative(destination))
    return contacts


def review_case(case: dict, browser: dict, executable: str, dpi: int) -> dict:
    pdf = (ROOT / case["path"]).resolve()
    pdf.relative_to(ROOT.resolve())
    actual_hash = sha256(pdf)
    channel, name = browser["channel"], case["name"]
    folder = RENDERS / channel / name / actual_hash[:12]
    folder.mkdir(parents=True, exist_ok=True)
    reader = PdfReader(pdf)
    subprocess.run([executable, "-r", str(dpi), "-png", str(pdf), str(folder / "page")],
                   check=True, capture_output=True)
    images = sorted(folder.glob("page-*.png"), key=lambda path: int(path.stem.rsplit("-", 1)[1]))
    expected_count = case.get("diagnostics", {}).get("pageCount", len(case["pages"]))
    page_checks = []
    for index, (page, image) in enumerate(zip(reader.pages, images)):
        check = raster_check(image, index + 1)
        dimensions = [float(page.mediabox.width), float(page.mediabox.height)]
        check.update({"pageSizePoints": dimensions,
                      "a4": abs(dimensions[0] - 595.276) < .02 and abs(dimensions[1] - 841.89) < .02,
                      "chartKinds": [chart["kind"] for chart in case["pages"][index].get("charts", [])]})
        page_checks.append(check)
    critical = [check for check in page_checks if any(kind in ("jumpFvp", "jumpElasticity") for kind in check["chartKinds"])]
    contacts = make_contacts(images, folder, f"{channel}-{name}")
    diagnostics = case.get("diagnostics", {})
    diagnostics_checks = {key: not diagnostics.get(key, []) for key in
                          ("missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts")}
    automated_pass = (actual_hash == case["sha256"] and len(images) == len(reader.pages) == expected_count
                      and all(check["a4"] and check["bodyNonblank"] and check["outerEdgesClear"] for check in page_checks)
                      and all(diagnostics_checks.values()))
    return {"channel": channel, "name": name, "sourceHash": browser["sourceHash"], "pdf": relative(pdf),
            "pdfSha256": actual_hash, "expectedPdfSha256": case["sha256"], "pdfHashMatches": actual_hash == case["sha256"],
            "bytes": pdf.stat().st_size, "pages": len(reader.pages), "expectedPages": expected_count,
            "imageCount": len(images), "renderDpi": dpi, "pageChecks": page_checks,
            "contactSheets": contacts, "criticalPages": [check["page"] for check in critical],
            "criticalImages": [check["image"] for check in critical], "diagnosticsChecks": diagnostics_checks,
            "automatedPass": automated_pass,
            "manualReview": {"status": "pending", "reviewedContactSheets": [], "reviewedCriticalImages": [], "issues": []}}


def write_visual_review(evidence: dict, render_manifest: Path, output: Path) -> dict:
    """Collect only explicitly recorded inspections, with current artifact hashes."""
    assert evidence["sourceHash"] == sha256(ROOT / "MotionBench.html"), "HTML changed after PDF export"
    images = []
    for screen in evidence.get("screenReviews", []):
        path = (ROOT / screen["path"]).resolve()
        path.relative_to(ROOT.resolve())
        assert sha256(path) == screen["sha256"], "Reviewed screenshot changed"
        images.append({**screen, "kind": "screen"})
    for case in evidence["cases"]:
        assert case["pdfSha256"] == sha256(ROOT / case["pdf"]), "Reviewed PDF changed"
        for page in case["pageChecks"]:
            assert page["imageSha256"] == sha256(ROOT / page["image"]), "Rendered PDF page changed"
        manual = case["manualReview"]
        for key, kind in [("reviewedContactSheets", "pdf_contact_sheet"),
                          ("reviewedCriticalImages", "pdf_critical_page")]:
            for name in manual.get(key, []):
                path = (ROOT / name).resolve()
                path.relative_to(ROOT.resolve())
                digest = sha256(path)
                assert manual.get("imageSha256", {}).get(name) == digest, "Reviewed PDF image changed"
                images.append({"path": name, "sha256": digest, "channel": case["channel"],
                               "case": case["name"], "kind": kind, "reviewed": True,
                               "pass": manual["status"] == "passed", "reviewer": manual["reviewer"],
                               "conclusion": manual.get("scope", "")})
    evidence["reviewedPdfPages"] = sum(case["pages"] for case in evidence["cases"]
                                        if case["manualReview"]["status"] == "passed")
    evidence["reviewedContactSheets"] = sum(len(case["manualReview"].get("reviewedContactSheets", []))
                                              for case in evidence["cases"])
    evidence["reviewedCriticalPages"] = sum(len(case["manualReview"].get("reviewedCriticalImages", []))
                                             for case in evidence["cases"])
    render_manifest.parent.mkdir(parents=True, exist_ok=True)
    render_manifest.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    result = {"sourceHash": evidence["sourceHash"], "pass": bool(evidence["pass"] and images
              and all(item["reviewed"] and item["pass"] for item in images)),
              "pdfPages": evidence["pdfPages"], "reviewedPdfPages": evidence["reviewedPdfPages"],
              "images": images, "pdfs": [{"path": case["pdf"], "sha256": case["pdfSha256"],
                                           "pages": case["pages"], "channel": case["channel"],
                                           "case": case["name"]} for case in evidence["cases"]],
              "pdfRenderReview": {"path": relative(render_manifest), "sha256": sha256(render_manifest)},
              "advisories": [{"channel": case["channel"], "case": case["name"], "issues": case["manualReview"].get("issues", [])}
                             for case in evidence["cases"] if case["manualReview"].get("issues")]}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", action="append", type=Path, help="Browser result JSON; repeat for both browsers.")
    parser.add_argument("--output", type=Path, default=RESULTS / "pdf-render-review.json")
    parser.add_argument("--dpi", type=int, default=110)
    parser.add_argument("--record-review", type=Path, help="Explicit human/agent inspection evidence with matching hashes.")
    parser.add_argument("--visual-output", type=Path, default=RESULTS / "visual-review.json")
    args = parser.parse_args()
    inputs = args.manifest or [path for path in [RESULTS / "chrome-results.json", RESULTS / "msedge-results.json"] if path.is_file()]
    if not inputs:
        raise SystemExit("No FVP browser result manifest found.")
    reviews = json.loads(args.record_review.read_text(encoding="utf-8")) if args.record_review else None
    evidence = {"browserResults": [], "cases": [], "manualReviewPass": False,
                "screenReviews": reviews.get("screenReviews", []) if reviews else []}
    executable = poppler_path()
    for manifest in inputs:
        browser = json.loads(manifest.read_text(encoding="utf-8"))
        evidence["browserResults"].append({"path": relative(manifest), "sha256": sha256(manifest),
                                           "channel": browser["channel"], "sourceHash": browser["sourceHash"],
                                           "pass": browser["pass"]})
        for case in browser["pdfs"]:
            result = review_case(case, browser, executable, args.dpi)
            if reviews:
                manual = next((item for item in reviews["cases"] if item["channel"] == result["channel"] and item["name"] == result["name"]), None)
                if manual:
                    assert manual["sourceHash"] == result["sourceHash"] and manual["pdfSha256"] == result["pdfSha256"], "Manual review is stale"
                    assert set(manual["reviewedContactSheets"]) == set(result["contactSheets"]), "Every page must be viewed through contacts"
                    assert set(manual["reviewedCriticalImages"]) == set(result["criticalImages"]), "Every FVP/response page must be viewed at full size"
                    assert manual["status"] in ("passed", "issues_found")
                    result["manualReview"] = manual
            evidence["cases"].append(result)
    hashes = sorted({result["sourceHash"] for result in evidence["browserResults"]})
    evidence["sourceHashes"] = hashes
    evidence["sourceHash"] = hashes[0] if len(hashes) == 1 else None
    evidence["sourceHashAgreement"] = len(hashes) == 1
    evidence["totalPages"] = sum(case["pages"] for case in evidence["cases"])
    evidence["pdfPages"] = evidence["totalPages"]
    evidence["totalImages"] = sum(case["imageCount"] for case in evidence["cases"])
    html = ROOT / "MotionBench.html"
    evidence["currentHtmlSha256"] = sha256(html) if html.is_file() else None
    evidence["sourceHashMatchesCurrentHtml"] = evidence["sourceHash"] == evidence["currentHtmlSha256"]
    evidence["crossBrowserIdenticalPixels"] = {}
    for name in {case["name"] for case in evidence["cases"]}:
        peers = [case for case in evidence["cases"] if case["name"] == name]
        if len(peers) > 1:
            first = [page["pixelSha256"] for page in peers[0]["pageChecks"]]
            evidence["crossBrowserIdenticalPixels"][name] = all([page["pixelSha256"] for page in case["pageChecks"]] == first for case in peers[1:])
    evidence["automatedPass"] = (evidence["sourceHashAgreement"] and evidence["sourceHashMatchesCurrentHtml"] and all(result["pass"] for result in evidence["browserResults"])
                                  and all(case["automatedPass"] for case in evidence["cases"]))
    evidence["manualReviewPass"] = all(case["manualReview"]["status"] == "passed" for case in evidence["cases"])
    evidence["pass"] = evidence["automatedPass"] and evidence["manualReviewPass"]
    visual = write_visual_review(evidence, args.output, args.visual_output)
    print(json.dumps({"output": relative(args.output), "sourceHash": evidence["sourceHash"], "totalPages": evidence["totalPages"],
                      "automatedPass": evidence["automatedPass"], "manualReviewPass": evidence["manualReviewPass"],
                      "visualOutput": relative(args.visual_output), "reviewedImages": len(visual["images"])}))


if __name__ == "__main__":
    main()
