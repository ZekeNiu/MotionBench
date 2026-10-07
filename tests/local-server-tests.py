"""Local relay boundary tests; upstream calls are mocked, never real/billable."""
import importlib.util
import io
import json
from pathlib import Path
import threading
import unittest
import hashlib
from unittest.mock import patch
import urllib.request
import urllib.error

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("motionbench_server", root / "scripts/serve.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RelayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = module.make_server(0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = "http://127.0.0.1:" + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def call(self, path="/api/relay", data=None, headers=None):
        request = urllib.request.Request(self.base + path, data=json.dumps(data or {}).encode() if path == "/api/relay" else None, headers=headers or {})
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.read()

    def test_no_token(self):
        self.assertEqual(self.call()[0], 403)

    def test_foreign_origin(self):
        self.assertEqual(self.call(headers={"Origin": "https://untrusted.invalid", "X-MotionBench-Token": self.server.token})[0], 403)

    def test_foreign_host(self):
        self.assertEqual(self.call("/", headers={"Host": "rebind.invalid"})[0], 403)

    def test_only_app_served(self):
        self.assertEqual(self.call("/src/ringside-app.js")[0], 404)

    def test_bootstrap(self):
        status, body = self.call("/MotionBench.html")
        self.assertEqual(status, 200)
        self.assertIn(self.server.token.encode(), body)

    def test_reject_urls(self):
        for base in ["http://api.example.com", "https://localhost", "https://127.0.0.1", "https://user:pass@api.example.com", "https://api.example.com?key=secret"]:
            with self.assertRaises(ValueError):
                module.provider_url(base, "/models")
        with self.assertRaises(ValueError):
            module.provider_url("https://api.example.com", "/not-an-ai-path")

    def test_public_provider_allows_vpn_dns(self):
        self.assertEqual(module.provider_url("https://api.apikey.fan/v1", "/models"), "https://api.apikey.fan/v1/models")

    def test_no_redirect(self):
        self.assertIsNone(module.NoRedirect().redirect_request(None, None, 302, "", {}, "https://elsewhere.invalid"))

    def test_upstream_json_and_credential(self):
        response = io.BytesIO(b'{"data":[{"id":"test-chat"}]}')
        response.status = 200
        with patch.object(module.urllib.request, "build_opener") as builder:
            builder.return_value.open.return_value = response
            status, body = self.call(data={"base": "https://api.example.com/v1", "path": "/models", "key": "synthetic-only"}, headers={"Origin": self.base, "X-MotionBench-Token": self.server.token})
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)["data"][0]["id"], "test-chat")
            request = builder.return_value.open.call_args[0][0]
            self.assertEqual(request.headers["Authorization"], "Bearer synthetic-only")


if __name__ == "__main__":
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(RelayTests))
    output = root / "output/tests/local-server-results.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"sourceHash": hashlib.sha256((root / "MotionBench.html").read_bytes()).hexdigest(), "serverHash": hashlib.sha256((root / "scripts/serve.py").read_bytes()).hexdigest(), "checks": result.testsRun, "pass": result.wasSuccessful()}, indent=2), encoding="utf-8")
    raise SystemExit(0 if result.wasSuccessful() else 1)
