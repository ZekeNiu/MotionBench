"""Render exact 2.19 browser PDFs for a separate visual inspection."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
from PIL import Image, ImageDraw, ImageChops
from pypdf import PdfReader
from review_fvp_pdf import poppler_path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/pdf/v2.19.0"
OUT.mkdir(parents=True, exist_ok=True)
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def relative(path):
    return path.relative_to(ROOT).as_posix()
def item(path):
    return {"path": relative(path), "sha256": digest(path)}

result = {"sourceHash": digest(ROOT / "MotionBench.html"), "cases": [], "comparisons": []}
renderer = poppler_path()
for group, naming in [("report", "{channel}-results.json"), ("scoring-report", "{channel}.json")]:
    if "--mean-only" in sys.argv and group != "scoring-report":
        continue
    for channel in ["chrome", "msedge"]:
        manifest = ROOT / "output/playwright/v2.19.0" / group / naming.format(channel=channel)
        data = json.loads(manifest.read_text(encoding="utf-8"))
        assert data["pass"] and data.get("sourceHash", data.get("sourceSha256")) == result["sourceHash"]
        for index, pdf in enumerate(data["pdfs"]):
            path = ROOT / pdf["file"]
            assert digest(path) == pdf["sha256"]
            folder = OUT / (group + "-" + channel + "-" + str(index))
            folder.mkdir(parents=True, exist_ok=True)
            subprocess.run([renderer, "-r", "110", "-png", str(path), str(folder / "page")], capture_output=True, check=True)
            images = sorted(folder.glob("page-*.png"), key=lambda p: int(p.stem.split("-")[-1]))
            pages = PdfReader(path).pages
            assert len(images) == len(pages) == pdf["diagnostics"]["pageCount"]
            checks = []
            for number, (page, image_path) in enumerate(zip(pages, images), 1):
                assert abs(float(page.mediabox.width) - 595.28) < .1 and abs(float(page.mediabox.height) - 841.89) < .1
                image = Image.open(image_path).convert("RGB")
                body = image.crop((40, 100, image.width - 40, image.height - 90))
                ink = ImageChops.difference(body, Image.new("RGB", body.size, "white")).convert("L")
                assert sum(ink.histogram()[25:]) > 100, (path, number, "empty body")
                checks.append({"page": number, **item(image_path), "pixelSha256": hashlib.sha256(image.tobytes()).hexdigest(), "a4": True, "bodyNonblank": True})
            contacts = []
            for first in range(0, len(images), 6):
                sheet = Image.new("RGB", (1800, 1750), "#edf0f4")
                draw = ImageDraw.Draw(sheet)
                for offset, image_path in enumerate(images[first:first + 6]):
                    image = Image.open(image_path).convert("RGB")
                    image.thumbnail((565, 810))
                    x, y = (offset % 3) * 600 + 15, (offset // 3) * 870 + 35
                    draw.text((x, y - 22), f"{group} {channel} #{index} Page {first + offset + 1}", fill="black")
                    sheet.paste(image, (x, y))
                contact = folder / f"contact-{first // 6 + 1}.png"
                sheet.save(contact)
                contacts.append(item(contact))
            result["cases"].append({"group": group, "channel": channel, "index": index, "pdf": item(path), "pages": checks, "contacts": contacts})
for case in [c for c in result["cases"] if c["channel"] == "chrome"]:
    peer = next(c for c in result["cases"] if c["channel"] == "msedge" and c["group"] == case["group"] and c["index"] == case["index"])
    identical = [p["pixelSha256"] for p in case["pages"]] == [p["pixelSha256"] for p in peer["pages"]]
    result["comparisons"].append({"group": case["group"], "index": case["index"], "identical": identical})
result["pass"] = True
(OUT / ("mean-renders.json" if "--mean-only" in sys.argv else "renders.json")).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"pdfs": len(result["cases"]), "pages": sum(len(c["pages"]) for c in result["cases"]), "comparisons": result["comparisons"]}))
