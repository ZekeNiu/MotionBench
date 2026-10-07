"""MotionBench local launcher. Standard-library only; never saves credentials."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
from pathlib import Path
import secrets
import socket
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
MAX_BODY = 8 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    # Never send a provider credential to a redirect target.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def provider_url(base, path):
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
        if (not self.valid_host() or self.path != "/api/relay"
                or self.headers.get("Origin") != self.origin
                or not secrets.compare_digest(self.headers.get("X-MotionBench-Token", ""), self.server.token)):
            return self.error(403, "请从本机启动页面发起请求")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                return self.error(413, "请求资料过大或为空")
            data = json.loads(self.rfile.read(length))
            url = provider_url(data["base"], data["path"])
            key = data["key"].strip()
            if not key or any(ord(c) < 32 for c in key):
                raise ValueError("请填写有效密钥")
            payload = data.get("payload")
            if (data["path"] == "/models" and payload is not None) or (data["path"] == "/chat/completions" and not isinstance(payload, dict)):
                raise ValueError("请求内容无效")
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
                    json.loads(content)
                except (ValueError, UnicodeDecodeError):
                    return self.error(response.status if response.status >= 400 else 502, "AI 服务未返回有效 JSON，请核对 API 地址")
                self.send(response.status, content)
        except (ValueError, KeyError, TypeError) as error:
            self.error(400, str(error) if isinstance(error, ValueError) else "请求内容无效")
        except (TimeoutError, socket.timeout):
            self.error(504, "AI 服务响应超时，请重试或更换模型")
        except (urllib.error.URLError, OSError):
            self.error(502, "无法连接 AI 服务，请检查网络与服务地址")


def make_server(port=8765, html_path=None):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    server.token = secrets.token_urlsafe(32)
    server.html_path = Path(html_path) if html_path else ROOT / "MotionBench.html"
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
    print("Keep this window open while using AI. Press Ctrl+C to stop. API keys are never saved.", flush=True)
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
