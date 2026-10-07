"""MotionBench local launcher with user-scoped Windows encrypted AI settings."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
from pathlib import Path
import secrets
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ai_credentials import CredentialError, CredentialStore

MAX_BODY = 8 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    # Never send a provider credential to a redirect target.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def provider_url(base, path):
    if not isinstance(base, str) or len(base) > 2048 or any(ord(c) < 32 for c in base):
        raise ValueError("请填写有效的 HTTPS API 基础地址")
    url = urllib.parse.urlsplit(base)
    if (url.scheme != "https" or not url.hostname or url.username or url.password
            or url.query or url.fragment or path not in {"/models", "/chat/completions"}):
        raise ValueError("请填写有效的 HTTPS API 基础地址")
    # VPN clients can resolve public domains to a local synthetic IP range.
    # Validate literal/local targets without rejecting a user's public provider
    # because of their network's DNS implementation. Origin + token guard relay use.
    try:
        literal = ipaddress.ip_address(url.hostname)
    except ValueError:
        literal = None
    if (literal is not None and not literal.is_global) or url.hostname == "localhost" or url.hostname.endswith((".localhost", ".local")):
        raise ValueError("本机连接入口只支持公网 HTTPS AI 服务")
    return base.rstrip("/") + path


def normalize_base(base):
    if not isinstance(base, str):
        raise ValueError("请填写有效的 HTTPS API 基础地址")
    base = base.strip().rstrip("/")
    for suffix in ["/chat/completions", "/models"]:
        if base.endswith(suffix):
            base = base[:-len(suffix)]
    if not base.endswith("/v1"):
        base += "/v1"
    provider_url(base, "/models")
    parsed = urllib.parse.urlsplit(base)
    # Normalize host casing/default port so a cosmetically edited address is identical.
    host = parsed.hostname.lower()
    port = parsed.port
    netloc = ("[" + host + "]" if ":" in host else host) + (":" + str(port) if port and port != 443 else "")
    return urllib.parse.urlunsplit(("https", netloc, parsed.path, "", ""))


def redact(value, key):
    if isinstance(value, str):
        return value.replace(key, "[密钥已隐藏]")
    if isinstance(value, list):
        return [redact(item, key) for item in value]
    if isinstance(value, dict):
        return {redact(name, key): redact(item, key) for name, item in value.items()}
    return value


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    @property
    def origin(self):
        return "http://127.0.0.1:" + str(self.server.server_port)

    def send(self, status, body, content_type="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def error(self, status, message):
        self.send(status, json.dumps({"error": {"message": message}}, ensure_ascii=False))

    def valid_host(self):
        return self.headers.get("Host") == self.origin.removeprefix("http://")

    def do_GET(self):
        if not self.valid_host():
            return self.error(403, "仅限本机访问")
        if self.path == "/health":
            return self.send(200, '{"app":"MotionBench"}')
        if self.path not in {"/", "/MotionBench.html"}:
            return self.error(404, "页面不存在")
        html = self.server.html_path.read_text(encoding="utf-8")
        bootstrap = '<script id="motionbench-local-bootstrap">window.MotionBenchLocal=' + json.dumps({"token": self.server.token}) + ';</script>'
        self.send(200, html.replace("</head>", bootstrap + "</head>", 1), "text/html; charset=utf-8")

    def do_POST(self):
        if (not self.valid_host() or self.path not in {"/api/relay", "/api/ai-settings"}
                or self.headers.get("Origin") != self.origin
                or not secrets.compare_digest(self.headers.get("X-MotionBench-Token", ""), self.server.token)):
            return self.error(403, "请从本机启动页面发起请求")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                return self.error(413, "请求资料过大或为空")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("请求内容无效")
            if self.path == "/api/ai-settings":
                try:
                    action = data.get("action")
                    if action == "status":
                        result = self.server.credentials.status()
                    elif action == "save":
                        result = self.server.credentials.save(normalize_base(data.get("base")), data.get("model", ""), data.get("key"), data.get("expectedRevision"))
                    elif action == "forget":
                        result = self.server.credentials.forget(data.get("expectedRevision"))
                    else:
                        raise ValueError("AI 设置操作无效")
                    return self.send(200, json.dumps(result, ensure_ascii=False))
                except OSError:
                    return self.error(500, "无法读写本机 AI 设置，原配置已保留，请检查磁盘与目录权限")
            if "key" in data or "base" in data:
                raise ValueError("本机 AI 请求应使用已保存的配置，请刷新页面后重试")
            connection = self.server.credentials.connection(data.get("configRevision"))
            url = provider_url(connection["base"], data["path"])
            key = connection["key"]
            payload = data.get("payload")
            if (data["path"] == "/models" and payload is not None) or (data["path"] == "/chat/completions" and not isinstance(payload, dict)):
                raise ValueError("请求内容无效")
            if payload is not None and (not connection["model"] or payload.get("model") != connection["model"]):
                raise CredentialError("模型与本机设置不一致，请保存所选模型后重试", 409)
            body = json.dumps(payload).encode("utf-8") if payload is not None else None
            request = urllib.request.Request(url, data=body, headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
            opener = urllib.request.build_opener(NoRedirect)
            try:
                response = opener.open(request, timeout=295 if payload else 55)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                content = response.read(MAX_BODY + 1)
                if len(content) > MAX_BODY:
                    return self.error(502, "AI 服务返回内容过大")
                # Responses remain JSON; upstream HTML is not served as a page.
                try:
                    decoded = json.loads(content)
                except (ValueError, UnicodeDecodeError):
                    return self.error(response.status if response.status >= 400 else 502, "AI 服务未返回有效 JSON，请核对 API 地址")
                self.send(response.status, json.dumps(redact(decoded, key), ensure_ascii=False))
        except CredentialError as error:
            self.error(error.status, str(error))
        except (ValueError, KeyError, TypeError) as error:
            self.error(400, str(error) if isinstance(error, ValueError) else "请求内容无效")
        except (TimeoutError, socket.timeout):
            self.error(504, "AI 服务响应超时，请重试或更换模型")
        except (urllib.error.URLError, OSError):
            self.error(502, "无法连接 AI 服务，请检查网络与服务地址")


def make_server(port=8765, html_path=None, config_dir=None):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    server.token = secrets.token_urlsafe(32)
    server.html_path = Path(html_path) if html_path else ROOT / "MotionBench.html"
    server.credentials = CredentialStore(config_dir)
    return server


def main():
    parser = argparse.ArgumentParser(description="Start MotionBench on this computer")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    try:
        server = make_server(args.port)
    except OSError:
        raise SystemExit("Port is occupied. Close the previous launcher or use --port with another port. Keep the same port to retain browser history.")
    if not server.html_path.is_file():
        raise SystemExit("MotionBench.html is missing. Keep the launcher and HTML in the same project folder.")
    url = "http://127.0.0.1:" + str(server.server_port) + "/MotionBench.html"
    print("MotionBench: " + url, flush=True)
    print("Keep this window open while using AI. Press Ctrl+C to stop. Saved AI settings are encrypted for this Windows user.", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
