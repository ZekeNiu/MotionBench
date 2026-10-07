"""Local relay boundary tests; upstream calls are mocked, never real/billable."""
import importlib.util
import io
import json
from pathlib import Path
import threading
import unittest
import hashlib
import subprocess
import sys
import tempfile
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
        cls.temporary = tempfile.TemporaryDirectory(prefix="motionbench-ai-tests-")
        cls.server = module.make_server(0, config_dir=Path(cls.temporary.name) / "initial")
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = "http://127.0.0.1:" + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.temporary.cleanup()

    def setUp(self):
        self.directory = Path(self.temporary.name) / self._testMethodName
        self.server.credentials = module.CredentialStore(self.directory)

    def headers(self):
        return {"Origin": self.base, "X-MotionBench-Token": self.server.token}

    def settings(self, action, **fields):
        status, body = self.call("/api/ai-settings", {"action": action, **fields}, self.headers())
        return status, json.loads(body)

    def saved(self, key="synthetic-only", model="test-chat"):
        status, value = self.settings("status")
        self.assertEqual(status, 200)
        status, value = self.settings("save", base="https://api.example.com/v1", model=model, key=key, expectedRevision=value["revision"])
        self.assertEqual(status, 200)
        return value

    def call(self, path="/api/relay", data=None, headers=None):
        request = urllib.request.Request(self.base + path, data=json.dumps(data or {}).encode() if path.startswith("/api/") else None, headers=headers or {})
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
        config = self.saved()
        response = io.BytesIO(b'{"data":[{"id":"test-chat"}]}')
        response.status = 200
        with patch.object(module.urllib.request, "build_opener") as builder:
            builder.return_value.open.return_value = response
            status, body = self.call(data={"path": "/models", "configRevision": config["revision"]}, headers=self.headers())
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)["data"][0]["id"], "test-chat")
            request = builder.return_value.open.call_args[0][0]
            self.assertEqual(request.headers["Authorization"], "Bearer synthetic-only")

    def test_settings_auth_and_no_get(self):
        for headers in [{}, {"Origin": "https://untrusted.invalid", "X-MotionBench-Token": self.server.token}, {**self.headers(), "Host": "rebind.invalid"}]:
            self.assertEqual(self.call("/api/ai-settings", {"action": "status"}, headers)[0], 403)
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(self.base + "/api/ai-settings")
        self.assertEqual(error.exception.code, 404)

    def test_real_dpapi_and_process_restart(self):
        config = self.saved()
        encrypted = (self.directory / "ai-settings.dat").read_bytes()
        self.assertNotIn(b"synthetic-only", encrypted)
        self.assertNotIn(b"api.example.com", encrypted)
        self.assertNotIn("key", config)
        script = "import json,sys;from ai_credentials import CredentialStore;s=CredentialStore(sys.argv[1]);v=s.status();assert s.connection(v['revision'])['key']=='synthetic-only';print(json.dumps(v))"
        result = subprocess.run([sys.executable, "-B", "-c", script, str(self.directory)], cwd=root / "scripts", capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout), config)

    def test_replace_keep_key_forget_and_revision(self):
        initial = self.saved()
        status, changed = self.settings("save", base=initial["base"], model="another-chat", expectedRevision=initial["revision"])
        self.assertEqual(status, 200)
        self.assertNotEqual(initial["revision"], changed["revision"])
        self.assertEqual(self.server.credentials.connection(changed["revision"])["key"], "synthetic-only")
        self.assertEqual(self.settings("forget", expectedRevision=initial["revision"])[0], 409)
        status, replaced = self.settings("save", base=initial["base"], model="another-chat", key="replacement-synthetic", expectedRevision=changed["revision"])
        self.assertEqual(status, 200)
        self.assertEqual(self.server.credentials.connection(replaced["revision"])["key"], "replacement-synthetic")
        status, forgotten = self.settings("forget", expectedRevision=replaced["revision"])
        self.assertEqual(status, 200)
        self.assertFalse(forgotten["hasKey"])
        self.assertEqual(forgotten["model"], "another-chat")
        self.assertEqual(forgotten["base"], initial["base"])
        self.assertEqual(self.call(data={"path": "/models", "configRevision": forgotten["revision"]}, headers=self.headers())[0], 409)
        self.assertEqual(module.CredentialStore(self.directory).status(), forgotten)

    def test_binding_and_normalized_base(self):
        config = self.saved()
        status, updated = self.settings("save", base="https://API.EXAMPLE.COM:443/v1/chat/completions/", model="test-chat", key="", expectedRevision=config["revision"])
        self.assertEqual(status, 200)
        self.assertEqual(updated["base"], config["base"])
        self.assertEqual(self.settings("save", base="https://other.example.com", model="test-chat", expectedRevision=updated["revision"])[0], 400)
        self.assertEqual(self.server.credentials.status(), updated)
        self.assertEqual(self.call(data={"path": "/models", "base": "https://other.example.com/v1", "configRevision": updated["revision"]}, headers=self.headers())[0], 400)

    def test_missing_key_and_model(self):
        self.assertEqual(self.settings("save", base="https://api.example.com", model="", expectedRevision="0")[0], 400)
        config = self.saved(model="")
        self.assertEqual(self.call(data={"path": "/chat/completions", "payload": {"model": "test-chat"}, "configRevision": config["revision"]}, headers=self.headers())[0], 409)

    def test_stale_connection_and_model(self):
        config = self.saved()
        self.assertEqual(self.call(data={"path": "/models", "configRevision": "stale"}, headers=self.headers())[0], 409)
        self.assertEqual(self.call(data={"path": "/chat/completions", "payload": {"model": "unsaved-model"}, "configRevision": config["revision"]}, headers=self.headers())[0], 409)

    def test_success_and_error_redact_nested_and_escaped_key(self):
        key = 'synthetic-quote-"-unicode-密钥'
        config = self.saved(key=key)
        for code in [200, 401]:
            response = io.BytesIO(json.dumps({"data": [{"id": "test-chat"}], "nested": [{key: "echo " + key}], "errorEcho": key}).encode())
            response.status = code
            with patch.object(module.urllib.request, "build_opener") as builder:
                builder.return_value.open.return_value = response
                status, body = self.call(data={"path": "/models", "configRevision": config["revision"]}, headers=self.headers())
            self.assertEqual(status, code)
            self.assertNotIn(key, body.decode())
            self.assertNotIn(key, json.dumps(json.loads(body), ensure_ascii=False))
            self.assertIn("[密钥已隐藏]", body.decode())

    def test_atomic_failure_keeps_old_and_cleans_temporary(self):
        config = self.saved()
        before = (self.directory / "ai-settings.dat").read_bytes()
        with patch("ai_credentials.os.replace", side_effect=OSError("synthetic disk failure")):
            status, body = self.settings("save", base=config["base"], model="changed", key="replacement", expectedRevision=config["revision"])
        self.assertEqual(status, 500)
        self.assertEqual((self.directory / "ai-settings.dat").read_bytes(), before)
        self.assertEqual(self.server.credentials.status(), config)
        self.assertEqual(list(self.directory.glob("*.tmp")), [])

    def test_encryption_failure_keeps_old_settings(self):
        config = self.saved()
        credential_module = sys.modules["ai_credentials"]
        original = credential_module._crypt
        def fail_encrypt(data, decrypt=False):
            if decrypt:
                return original(data, decrypt=True)
            raise module.CredentialError("Windows 无法加密 AI 设置，原配置已保留", 503)
        with patch("ai_credentials._crypt", side_effect=fail_encrypt):
            status, body = self.settings("save", base=config["base"], model="changed", key="replacement", expectedRevision=config["revision"])
        self.assertEqual(status, 503)
        self.assertEqual(self.server.credentials.status(), config)
        self.assertFalse(any(self.directory.glob("*.tmp")))

    def test_request_snapshot_keeps_original_bound_connection(self):
        config = self.saved()
        snapshot = self.server.credentials.connection(config["revision"])
        status, updated = self.settings("save", base="https://different.example.com/v1", model="different-model", key="replacement-synthetic", expectedRevision=config["revision"])
        self.assertEqual(status, 200)
        self.assertEqual(snapshot["base"], "https://api.example.com/v1")
        self.assertEqual(snapshot["key"], "synthetic-only")
        self.assertEqual(snapshot["model"], "test-chat")
        self.assertEqual(self.server.credentials.connection(updated["revision"])["key"], "replacement-synthetic")

    def test_corrupt_encrypted_file_recover(self):
        self.saved()
        (self.directory / "ai-settings.dat").write_bytes(b"not-dpapi-encrypted")
        status, broken = self.settings("status")
        self.assertEqual(status, 200)
        self.assertEqual(broken["state"], "unreadable")
        self.assertFalse(broken["hasKey"])
        self.assertEqual(self.settings("save", base=broken["base"], model="test-chat", expectedRevision=broken["revision"])[0], 400)
        status, restored = self.settings("save", base="https://api.example.com", model="test-chat", key="new-synthetic", expectedRevision=broken["revision"])
        self.assertEqual(status, 200)
        self.assertTrue(restored["hasKey"])

    def test_revision_race_between_stores(self):
        config = self.saved()
        second = module.CredentialStore(self.directory)
        second.save(config["base"], "new-model", None, config["revision"])
        self.assertEqual(self.settings("forget", expectedRevision=config["revision"])[0], 409)

    def test_private_or_invalid_provider_not_saved(self):
        config = self.saved()
        for base in ["http://api.example.com", "https://localhost", "https://127.0.0.1", "https://user:pass@api.example.com", "https://api.example.com?key=secret"]:
            self.assertEqual(self.settings("save", base=base, model="test-chat", key="synthetic", expectedRevision=config["revision"])[0], 400)
        self.assertEqual(self.server.credentials.status(), config)


if __name__ == "__main__":
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(RelayTests))
    output = root / "output/tests/local-server-results.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"sourceHash": hashlib.sha256((root / "MotionBench.html").read_bytes()).hexdigest(), "serverHash": hashlib.sha256((root / "scripts/serve.py").read_bytes()).hexdigest(), "checks": result.testsRun, "pass": result.wasSuccessful()}, indent=2), encoding="utf-8")
    raise SystemExit(0 if result.wasSuccessful() else 1)
