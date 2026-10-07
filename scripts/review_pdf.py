"""Render every downloaded PDF page and record A4/raster checks for visual review."""
from pathlib import Path
import hashlib
import json
import os
import sys
import shutil
import subprocess
from PIL import Image, ImageChops, ImageDraw
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf"
poppler = os.environ.get("RINGSIDE_PDFTOPPM") or shutil.which("pdftoppm")
if not poppler:
    bundled = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe"
    if bundled.exists():
        poppler = str(bundled)
if not poppler:
    raise SystemExit("Set RINGSIDE_PDFTOPPM to pdftoppm, or install Poppler.")

manifest_name = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--manifest=")), "download-verification.json")
render_name = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--output=")), "render-verification.json")
manifest = json.loads((OUT / manifest_name).read_text(encoding="utf-8"))
checks = {"sourceHash": manifest["sourceHash"], "cases": [], "crossBrowserIdenticalPixels": {}}
pixel_hashes = {}
for case in manifest["cases"]:
    if not case["pass"]:
        raise SystemExit("PDF download failed: " + case["id"])
    name = case["id"]
    pdf = OUT / (name + ".pdf")
    reader = PdfReader(pdf)
    folder = OUT / "rendered" / name
    folder.mkdir(parents=True, exist_ok=True)
    for pattern in ["page-*.png", "contact-*.png"]:
        for old in folder.glob(pattern):
            old.unlink()
    subprocess.run([poppler, "-r", "110", "-png", str(pdf), str(folder / "page")], check=True, capture_output=True)
    pages = sorted(folder.glob("page-*.png"), key=lambda p: int(p.stem.rsplit("-", 1)[1]))
    assert len(pages) == len(reader.pages) == case["diagnostics"]["pageCount"]
    page_checks = []
    hashes = []
    for index, (page, image_path) in enumerate(zip(reader.pages, pages)):
        width, height = float(page.mediabox.width), float(page.mediabox.height)
        assert abs(width - 595.276) < .02 and abs(height - 841.89) < .02
        image = Image.open(image_path).convert("RGB")
        hashes.append(hashlib.sha256(image.tobytes()).hexdigest())
        # Exclude repeating header/footer. A white body would expose a blank page.
        body = image.crop((40, 100, image.width - 40, image.height - 90))
        ink = ImageChops.difference(body, Image.new("RGB", body.size, "white")).convert("L")
        nonwhite = sum(ink.histogram()[25:])
        assert nonwhite > 100, (name, index + 1, "empty body")
        page_checks.append({"page": index + 1, "a4": True, "render": str(image_path.relative_to(ROOT)), "bodyInkPixels": nonwhite})
    pixel_hashes[name] = hashes
    sheets = []
    for first in range(0, len(pages), 6):
        selected = pages[first:first + 6]
        sheet = Image.new("RGB", (1200, 1190), "#edf0f4")
        draw = ImageDraw.Draw(sheet)
        for offset, image_path in enumerate(selected):
            image = Image.open(image_path).convert("RGB")
            image.thumbnail((380, 545))
            x, y = (offset % 3) * 400 + 10, (offset // 3) * 590 + 25
            draw.text((x, y - 18), f"{name}  page {first + offset + 1}", fill="#202b3b")
            sheet.paste(image, (x, y))
        destination = folder / f"contact-{first // 6 + 1}.png"
        sheet.save(destination)
        sheets.append(str(destination.relative_to(ROOT)))
    checks["cases"].append({"id": name, "pages": len(pages), "bytes": pdf.stat().st_size, "pdfSha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "pageChecks": page_checks, "contactSheets": sheets})
for other in ["edge-sample", "chrome-mobile"]:
    if other in pixel_hashes and "chrome-sample" in pixel_hashes:
        checks["crossBrowserIdenticalPixels"][other] = pixel_hashes[other] == pixel_hashes["chrome-sample"]
checks["pass"] = True
(OUT / render_name).write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding="utf-8")
print("Rendered all downloaded PDFs:", ", ".join(f"{x['id']} {x['pages']} pages" for x in checks["cases"]))
print("Cross-browser pixel equality:", checks["crossBrowserIdenticalPixels"])

if "--focused" in sys.argv:
    raise SystemExit(0)

# The actual UI workflow also downloads a report with custom athlete background.
# Re-render its current file instead of carrying forward an older review record.
workflow = json.loads((ROOT / "output/playwright/workflow-verification-results.json").read_text(encoding="utf-8"))
assert workflow["sourceHash"] == manifest["sourceHash"], "Background PDF workflow is stale"
background_case = next(case for case in workflow["tests"] if case["id"] == "pdf-background")
assert background_case["pass"]
pdf = ROOT / "output/playwright/workflow-sport-hand-report.pdf"
folder = OUT / "rendered/workflow-sport-hand"
folder.mkdir(parents=True, exist_ok=True)
for old in folder.glob("page-*.png"):
    old.unlink()
subprocess.run([poppler, "-r", "110", "-png", str(pdf), str(folder / "page")], check=True, capture_output=True)
reader = PdfReader(pdf)
pages = sorted(folder.glob("page-*.png"), key=lambda p: int(p.stem.rsplit("-", 1)[1]))
assert len(reader.pages) == len(pages)
page_checks = []
for index, (page, rendered) in enumerate(zip(reader.pages, pages)):
    assert abs(float(page.mediabox.width) - 595.276) < .02 and abs(float(page.mediabox.height) - 841.89) < .02
    page_checks.append({"page": index + 1, "a4": True, "render": str(rendered.relative_to(ROOT))})
background = {"sourceHash": workflow["sourceHash"], "pdfSha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "pages": len(pages), "background": background_case["detail"]["background"], "pageChecks": page_checks, "pass": True}
(OUT / "workflow-background-render-verification.json").write_text(json.dumps(background, ensure_ascii=False, indent=2), encoding="utf-8")
print("Rendered background PDF:", len(pages), "pages")
