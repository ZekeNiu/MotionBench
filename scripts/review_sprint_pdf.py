"""Render every page of a synthetic sprint acceptance PDF for visual review.

Run after tests/sprint-fvp-browser-tests.cjs --pdf. The contact sheets are
review aids; individual 110 dpi page PNGs remain the visual-QA source.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

from PIL import Image, ImageChops, ImageDraw
from pypdf import PdfReader


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    # Windows execution sandboxes can allow file reads but deny the metadata
    # handle used by Path.resolve(); a lexical absolute path is sufficient here.
    pdf = args.pdf.absolute()
    if not pdf.is_file():
        raise SystemExit(f"PDF does not exist: {pdf}")
    out = args.out or pdf.parent / (pdf.stem + "-rendered")
    out.mkdir(parents=True, exist_ok=True)
    renderer = shutil.which("pdftoppm")
    if not renderer:
        raise SystemExit("pdftoppm is required to render the actual exported PDF")
    reader = PdfReader(pdf)
    subprocess.run(
        [renderer, "-png", "-r", "110", str(pdf), str(out / "page")],
        check=True,
        capture_output=True,
    )
    files = sorted(out.glob("page-*.png"), key=lambda p: int(p.stem.split("-")[-1]))
    if len(files) != len(reader.pages):
        raise SystemExit("Rendered page count differs from the exported PDF")
    pages = []
    for index, file in enumerate(files, 1):
        with Image.open(file) as page:
            rgb = page.convert("RGB")
            ink = ImageChops.difference(rgb, Image.new("RGB", rgb.size, "white"))
            pages.append({"page": index, "png": str(file), "size": list(rgb.size),
                          "inkBounds": ink.getbbox(),
                          "sha256": hashlib.sha256(file.read_bytes()).hexdigest(),
                          "pdfPointSize": [float(reader.pages[index-1].mediabox.width),
                                           float(reader.pages[index-1].mediabox.height)]})
            if ink.getbbox() is None:
                raise SystemExit(f"Blank PDF page: {index}")
    contact_files = []
    width, height, gap = 420, 600, 20
    for start in range(0, len(files), 6):
        chunk = files[start:start+6]
        sheet = Image.new("RGB", (3 * width + 4 * gap, 2 * height + 3 * gap), "#dfe5eb")
        draw = ImageDraw.Draw(sheet)
        for offset, file in enumerate(chunk):
            with Image.open(file) as page:
                thumbnail = page.convert("RGB")
                thumbnail.thumbnail((width, height - 30))
                x = gap + (offset % 3) * (width + gap)
                y = gap + (offset // 3) * (height + gap)
                sheet.paste(thumbnail, (x, y + 25))
                draw.text((x, y), f"Page {start+offset+1}", fill="black")
        target = out / f"contact-{start // 6 + 1}.png"
        sheet.save(target)
        contact_files.append(str(target))
    evidence = {"pdf": str(pdf), "pdfSha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
                "pages": pages, "contactSheets": contact_files,
                "visualReview": "pending; inspect every page PNG before approving layout"}
    (out / "render-results.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps({"pages": len(pages), "rendered": str(out),
                      "contactSheets": contact_files}, ensure_ascii=False))


if __name__ == "__main__":
    main()
