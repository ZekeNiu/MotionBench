"""Replay an exact synthetic acceptance payload without the browser CORS layer.

This is diagnostic evidence only, not proof of ordinary file:// connectivity.
Credentials are read from the process environment and never written to disk.
"""
from pathlib import Path
import json
import os
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
source = json.loads((ROOT / "output/ai/browser-direct-verification.json").read_text(encoding="utf-8"))
body = source["cases"][0]["requestBody"]
key = os.environ["RINGSIDE_AI_KEY"]
result = {
    "sourceHash": source["sourceHash"],
    "service": source["service"],
    "model": body["model"],
    "transport": "direct-http-diagnostic",
    "case": source["cases"][0]["id"],
    "requestBody": body,
    "timeoutSeconds": 120,
    "pass": False,
}
request = urllib.request.Request(
    source["service"] + "/v1/chat/completions",
    data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
    headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
)
started = time.monotonic()
try:
    with urllib.request.urlopen(request, timeout=120) as response:
        result["status"] = response.status
        result["response"] = json.loads(response.read().decode("utf-8"))
        result["pass"] = bool(result["response"].get("choices", [{}])[0].get("message", {}).get("content"))
except urllib.error.HTTPError as error:
    result["status"] = error.code
    result["error"] = error.read().decode("utf-8", errors="replace").replace(key, "[redacted]")
except Exception as error:
    result["error"] = type(error).__name__
result["elapsedMs"] = round((time.monotonic() - started) * 1000)
(ROOT / "output/ai/full-payload-http.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2).replace(key, "[redacted]"), encoding="utf-8"
)
print(json.dumps({field: result.get(field) for field in ["pass", "status", "elapsedMs", "error"]}))
