"""Bind the focused 2.11 acceptance to its final reproducible artifact."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


artifact = ROOT / "MotionBench.html"
source_hash = digest(artifact)
assert source_hash == digest(ROOT / "Ringside_Boxing_Assessment.html")
html = artifact.read_text(encoding="utf-8")
assert re.search(r'<script id="embedded-data" type="application/json">\s*null\s*</script>', html)
for path in (ROOT / "src").glob("*.css"):
    assert path.read_text(encoding="utf-8") in html, path.name
evidence = {}


def read(name, relative):
    path = ROOT / relative
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["sourceHash"] == source_hash, "Stale evidence: " + relative
    evidence[name] = {"path": relative, "sha256": digest(path)}
    return data


def clean(data):
    assert data["pass"] and not data.get("errors"), data.get("failure")


def files(items):
    for item in items:
        assert digest(ROOT / item["path"]) == item["sha256"], item["path"]


unit = read("unit", "output/tests/unit-results.json")
assert len(unit["suites"]) == 16
assert all(s["exitCode"] == 0 and s["checksPassed"] > 0 for s in unit["suites"])
model_checks = sum(s["checksPassed"] for s in unit["suites"])
assert any(s["name"] == "derived-jump-model-tests.cjs" and s["checksPassed"] >= 21 for s in unit["suites"])
browser_checks = 0
for channel in ["chrome", "msedge"]:
    entry = read(channel + "Entry", f"output/v211-entry/{channel}-results.json")
    interaction = read(channel + "Interaction", f"output/playwright/v211/{channel}-interaction.json")
    for data in [entry, interaction]:
        clean(data)
        browser_checks += len(data["checks"])
    assert entry["backupRestored"] and len(entry["checks"]) >= 9
    files(entry["images"])
    assert len(interaction["checks"]) >= 7
    assert all(not item["overflow"] for item in interaction["layouts"])
    if channel == "chrome":
        pdf = interaction["pdf"]
        assert all(not page["overflow"] for page in pdf["pages"])
        for key in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]:
            assert not pdf["diagnostics"][key]
for name, relative in [
    ("legacyWorkflow", "output/playwright/refinement/chrome-workflow.json"),
    ("legacyRaces", "output/playwright/refinement-races/chrome-races.json"),
]:
    data = read(name, relative)
    clean(data)
    browser_checks += len(data["checks"])

server = read("localServer", "output/tests/local-server-results.json")
clean(server)
assert server["checks"] >= 20
assert server["serverHash"] == digest(ROOT / "scripts/serve.py")
ai = read("encryptedAI", "output/playwright/ai-settings/results.json")
clean(ai)
assert ai["serverHash"] == digest(ROOT / "scripts/serve.py")
assert ai["credentialStoreHash"] == digest(ROOT / "scripts/ai_credentials.py")
assert {c["channel"] for c in ai["cases"]} == {"chrome", "msedge"}
for case in ai["cases"]:
    clean(case)
    assert len(case["checks"]) >= 13
    browser_checks += len(case["checks"])
visual = read("pdfVisual", "output/playwright/v211/pdf-review.json")
clean(visual)
files([visual["pdf"]])
files(visual["renderedPages"])
assert visual["reviewedPages"] == visual["totalPages"] == len(visual["renderedPages"])
result = {
    "pass": True, "version": "2.11.0", "acceptanceScope": "Core acceptance requested by user; no claim to repeat every historical suite.",
    "html": artifact.name, "sha256": source_hash, "bytes": artifact.stat().st_size,
    "reproducibleBuild": True,
    "sourceModules": {p.relative_to(ROOT).as_posix(): digest(p) for p in sorted((ROOT / "src").glob("*")) if p.is_file()},
    "serverModules": {"scripts/" + name: digest(ROOT / "scripts" / name) for name in ["serve.py", "ai_credentials.py"]},
    "evidence": evidence, "modelChecks": model_checks, "serverChecks": server["checks"],
    "browserChecks": browser_checks, "pdfPagesVisuallyReviewed": visual["reviewedPages"],
    "rollback": {"tag": "v2.10.0", "commit": "73e7ef56f1ebe6c91db84aeeac3923a1ea8de7be"},
    "verificationLimits": [
        "Synthetic measurements and isolated Chrome/Edge profiles; no personal athlete records used.",
        "Windows DPAPI, browser restart and launcher restart tested with synthetic keys and a mock upstream; real provider quality and physical test devices were not checked.",
        "Narrow-screen layout uses browser viewports; no physical phone or printer acceptance.",
        "Focused final-artifact verification; historical capacity and exhaustive PDF suites were not all repeated.",
    ],
}
for relative in ["output/acceptance-manifest.json", "docs/acceptance-2.11.0.json"]:
    (ROOT / relative).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"PASS 2.11.0: {model_checks} model, {server['checks']} server, {browser_checks} browser checks; {visual['reviewedPages']} PDF pages")
print(source_hash)
