"""Read-only relay diagnostics. Credentials are accepted only from the environment."""
import json
import os
import urllib.request
import urllib.error
import sys

base = os.environ.get("RINGSIDE_AI_URL", "https://api.apikey.fan").rstrip("/")
key = os.environ["RINGSIDE_AI_KEY"]
results = []
for method, path in [("OPTIONS", "/v1/models"), ("OPTIONS", "/v1/chat/completions"), ("GET", "/v1/models")]:
    headers = {"Origin": "null"}
    if method == "OPTIONS":
        headers.update({"Access-Control-Request-Method": "POST" if "chat" in path else "GET", "Access-Control-Request-Headers": "authorization,content-type"})
    else:
        headers["Authorization"] = "Bearer " + key
    request = urllib.request.Request(base + path, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(request, timeout=40)
    except urllib.error.HTTPError as error:
        response = error
    except Exception as error:
        results.append({"method": method, "path": path, "error": str(error).replace(key, "[redacted]")})
        continue
    with response:
        item = {"method": method, "path": path, "status": response.status, "cors": {k: v for k, v in response.headers.items() if k.lower().startswith("access-control")}}
        body = response.read().decode("utf-8", errors="replace")
        if method == "GET":
            try:
                data = json.loads(body)
                ids = [m["id"] for m in data.get("data", [])]
                item["modelCount"] = len(ids)
                item["models"] = ids
                if not ids:
                    item["error"] = data.get("error", "No models returned")
            except ValueError:
                item["bodyType"] = "not JSON"
        results.append(item)
print(json.dumps(results, ensure_ascii=True).replace(key, "[redacted]"))
if "--chat" in sys.argv:
    payload = {"model": os.environ.get("RINGSIDE_AI_MODEL", "gpt-6.1-sol"), "messages": [{"role": "user", "content": "Reply with OK only."}], "stream": False}
    request = urllib.request.Request(base + "/v1/chat/completions", data=json.dumps(payload).encode(), headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        response = urllib.request.urlopen(request, timeout=175)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read().decode("utf-8", errors="replace")
        print(json.dumps({"chatStatus": response.status, "response": json.loads(body)}, ensure_ascii=True).replace(key, "[redacted]"))
