"""Combine completed human/agent page reviews; never infer review from rendering."""
from pathlib import Path
from PIL import Image
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

source_hash = sha(ROOT / "MotionBench.html")
management_path = ROOT / "output/playwright/refinement/management-visual-review.json"
report_path = ROOT / "output/report-refinement/visual-review.json"
v210_path = ROOT / "output/report-v210/visual-review.json"
imtp_path = ROOT / "output/imtp-layout-v210/visual-review.json"
management = json.loads(management_path.read_text(encoding="utf-8"))
report = json.loads(report_path.read_text(encoding="utf-8"))
v210 = json.loads(v210_path.read_text(encoding="utf-8"))
imtp = json.loads(imtp_path.read_text(encoding="utf-8"))
assert management["sourceHash"] == report["sourceHash"] == v210["sourceHash"] == imtp["sourceHash"] == source_hash
assert management["pass"] and not management["issues"] and report["pass"]
assert management["fullPageInspections"] == management["uniquePages"]
assert all(c["allPagesVisuallyReviewed"] for c in report["cases"])
assert v210["pass"] and all(c["allPagesVisuallyReviewed"] for c in v210["cases"])
assert imtp["pass"] and all(c["allPagesVisuallyReviewed"] for c in imtp["cases"])

pages = []
for row in management["pages"] + [p for review in [report, v210, imtp] for c in review["cases"] for p in c["pages"]]:
    path = ROOT / row["path"]
    assert sha(path) == row["sha256"]
    pixels = hashlib.sha256(Image.open(path).convert("RGB").tobytes()).hexdigest()
    pages.append({"path": path.relative_to(ROOT).as_posix(), "sha256": row["sha256"], "pixelHash": pixels})
assert len(pages) == management["totalPages"] + report["reviewedPdfPages"] + v210["reviewedPdfPages"] + imtp["reviewedPdfPages"]

# These representative UI screenshots were directly inspected by the lead agent.
browser = []
for name in ["chrome-report-390.png", "chrome-step2.png", "chrome-entry-390.png", "chrome-step4.png"]:
    path = ROOT / "output/playwright/refinement" / name
    browser.append({"path": path.relative_to(ROOT).as_posix(), "sha256": sha(path)})
unique = len({p["pixelHash"] for p in pages})
result = {
    "sourceHash": source_hash, "pass": True, "issues": [],
    "method": "Combined four completed full-page visual reviews with verified image hashes; pixel-identical pages share a reviewed representative from this implementation round. Selected workflow UI screenshots were separately inspected.",
    "reviewEvidence": [{"path": p.relative_to(ROOT).as_posix(), "sha256": sha(p)} for p in [management_path, report_path, v210_path, imtp_path]],
    "totalPDFPages": len(pages), "reviewedUniquePages": unique, "pixelIdenticalPages": len(pages) - unique,
    "images": pages + browser,
    "limits": ["Synthetic records; browser viewport simulation, not physical mobile or printer testing."]
}
(ROOT / "output/playwright/refinement/visual-review.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Combined verified reviews: {len(pages)} pages, {unique} unique, {len(pages)-unique} pixel-identical pages")
