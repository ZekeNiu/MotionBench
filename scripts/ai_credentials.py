"""User-scoped Windows DPAPI storage. No plaintext credentials are written."""
from contextlib import contextmanager
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import threading
import uuid


class CredentialError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _crypt(data, decrypt=False):
    if os.name != "nt":
        raise CredentialError("加密保存仅支持 Windows 本机启动入口", 503)

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    source_buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    source = Blob(len(data), source_buffer)
    target = Blob()
    function = crypt32.CryptUnprotectData if decrypt else crypt32.CryptProtectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob),
                         ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    # CRYPTPROTECT_UI_FORBIDDEN; deliberately no CRYPTPROTECT_LOCAL_MACHINE.
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise CredentialError("无法解密本机 AI 设置，请重新填写并保存" if decrypt else "Windows 无法加密 AI 设置，原配置已保留", 503)
    try:
        return ctypes.string_at(target.pbData, target.cbData)
    finally:
        kernel32.LocalFree(target.pbData)


class CredentialStore:
    def __init__(self, directory=None):
        base = directory or (Path(os.environ["LOCALAPPDATA"]) / "MotionBench" if os.environ.get("LOCALAPPDATA") else None)
        self.directory = Path(base) if base else None
        self.thread_lock = threading.RLock()

    @contextmanager
    def _locked(self):
        if os.name != "nt" or self.directory is None:
            raise CredentialError("加密保存仅支持 Windows 本机启动入口", 503)
        import msvcrt
        with self.thread_lock:
            self.directory.mkdir(parents=True, exist_ok=True)
            with (self.directory / "ai-settings.lock").open("a+b") as handle:
                if handle.seek(0, 2) == 0:
                    handle.write(b"\0")
                    handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
                try:
                    yield
                finally:
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)

    @staticmethod
    def _empty(revision="0", state="empty"):
        return {"schema": 1, "base": "https://api.apikey.fan/v1", "model": "", "key": "", "revision": revision, "state": state}

    def _read(self):
        path = self.directory / "ai-settings.dat"
        if not path.exists():
            return self._empty()
        data = path.read_bytes()
        broken_revision = "unreadable:" + hashlib.sha256(data).hexdigest()
        try:
            if len(data) > 131072:
                raise ValueError("oversize")
            value = json.loads(_crypt(data, decrypt=True))
            if (not isinstance(value, dict) or value.get("schema") != 1
                    or any(not isinstance(value.get(name), str) for name in ["base", "model", "key", "revision"])):
                raise ValueError("schema")
            return {**value, "state": "ready" if value["key"] else "empty"}
        except (CredentialError, ValueError, UnicodeError):
            return self._empty(broken_revision, "unreadable")

    @staticmethod
    def public(value):
        return {name: value[name] for name in ["base", "model", "revision", "state"]} | {"hasKey": bool(value["key"])}

    def status(self):
        if os.name != "nt" or self.directory is None:
            return self.public(self._empty("0", "unsupported"))
        with self._locked():
            return self.public(self._read())

    @staticmethod
    def _check_revision(value, expected):
        if not isinstance(expected, str) or expected != value["revision"]:
            raise CredentialError("AI 设置已在其他页面更新，请重新载入设置后重试", 409)

    def _write(self, value):
        data = _crypt(json.dumps({name: value[name] for name in ["schema", "base", "model", "key", "revision"]}, ensure_ascii=False).encode("utf-8"))
        temporary = self.directory / (".ai-settings-" + uuid.uuid4().hex + ".tmp")
        try:
            with temporary.open("xb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.directory / "ai-settings.dat")
        finally:
            temporary.unlink(missing_ok=True)

    def save(self, base, model, key, expected_revision):
        if not isinstance(model, str) or len(model) > 512 or any(ord(c) < 32 for c in model):
            raise CredentialError("模型名称无效")
        if key is not None and (not isinstance(key, str) or len(key) > 16384 or any(ord(c) < 32 for c in key)):
            raise CredentialError("密钥格式无效")
        key = key.strip() if key else ""
        with self._locked():
            previous = self._read()
            self._check_revision(previous, expected_revision)
            if not key:
                if base != previous["base"]:
                    raise CredentialError("更换服务地址时请填写该服务的密钥")
                if previous["state"] == "unreadable" or not previous["key"]:
                    raise CredentialError("请填写密钥")
                key = previous["key"]
            value = {"schema": 1, "base": base, "model": model.strip(), "key": key, "revision": uuid.uuid4().hex, "state": "ready"}
            self._write(value)
            return self.public(value)

    def forget(self, expected_revision):
        with self._locked():
            previous = self._read()
            self._check_revision(previous, expected_revision)
            value = {**previous, "key": "", "revision": uuid.uuid4().hex, "state": "empty"}
            self._write(value)
            return self.public(value)

    def connection(self, revision):
        with self._locked():
            value = self._read()
            self._check_revision(value, revision)
            if not value["key"] or value["state"] != "ready":
                raise CredentialError("请先保存有效的 AI 密钥", 409)
            return dict(value)
