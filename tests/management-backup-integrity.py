"""Compare every persisted entity in the real 3000-record backup roundtrip."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/playwright/management"


def digest(path):
    checksum, counts = hashlib.sha256(), {}
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            if row["type"] in {"header", "end"}:
                continue
            counts[row["type"]] = counts.get(row["type"], 0) + 1
            checksum.update(json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    return {"sha256": checksum.hexdigest(), "counts": counts}


for channel in ["chrome", "msedge"]:
    before = digest(OUT / f"{channel}-capacity.motionbench.jsonl")
    after = digest(OUT / f"{channel}-capacity-restored.motionbench.jsonl")
    assert before == after, (channel, before, after)
    assert before["counts"] == {"config": 1, "group": 10, "profile": 1, "athlete": 300, "record": 3000}
    report = OUT / f"{channel}-capacity.json"
    result = json.loads(report.read_text(encoding="utf-8"))
    result["allEntitiesRoundtrip"] = before
    result["allEntitiesExact"] = True
    report.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("PASS", channel, "all entities exact, including directory, scheme, groups and selection")
