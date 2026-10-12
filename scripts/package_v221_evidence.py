"""Package only frozen 2.20.1 acceptance dependencies; never change receipts."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import re
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION, DESKTOP_VERSION = "2.20.1", "2.20.1-desktop.1"
ACCEPTANCE = "docs/acceptance-2.20.1.json"
ACCEPTANCE_MD = "docs/acceptance-2.20.1.md"
DESTINATION = "output/release/MotionBench-2.20.1-evidence.zip"
RELEASE_TAG = "v2.20.1-desktop.1"
TEXT_EXTENSIONS = {".json", ".jsonl", ".md", ".txt", ".py", ".cjs", ".js", ".css", ".html", ".yml", ".yaml", ".cs", ".ps1", ".csv", ".tsv", ".svg", ".xml"}
SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_-]{32,}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{30,}"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----"),
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def workspace_file(relative):
    require(isinstance(relative, str) and relative and "\\" not in relative and ":" not in relative, "Invalid relative path")
    logical = PurePosixPath(relative)
    require(not logical.is_absolute() and ".." not in logical.parts and logical.as_posix() == relative, "Noncanonical or escaping path: " + relative)
    logical_path = ROOT / relative
    require(not logical_path.is_symlink(), "Symlinks are excluded: " + relative)
    path = logical_path.resolve()
    require(path.is_relative_to(ROOT) and path.is_file(), "Missing or outside-workspace file: " + relative)
    return path


def file_digest(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def detail(relative, content):
    return {"path": relative, "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def inspect_text(relative, content):
    name = PurePosixPath(relative).name.lower()
    require(not (name == ".env" or name.startswith(".env.") or name == "ai-settings.dat" or PurePosixPath(name).suffix in {".key", ".pem", ".p12", ".pfx"}), "Credential file is excluded: " + relative)
    # ASAR, PDF, images and XLSX are binary; decoding arbitrary bytes would make
    # random byte sequences appear to be provider credentials.
    if PurePosixPath(relative).suffix.lower() not in TEXT_EXTENSIONS:
        return
    text = content.decode("utf-8-sig")
    require(not any(pattern.search(text) for pattern in SECRET_PATTERNS), "Credential-like text is excluded: " + relative)


def review_instructions(external):
    destinations = "\n".join("- `" + item["assetName"] + "` → `" + item["path"] + "`" for item in external)
    return f"""# MotionBench 2.20.1 证据复核

本包按已冻结验收清单保留相对路径，包含源码、HTML、测试回执、截图、PDF、XLSX、JSONL 和正式程序 ASAR。PDF 证据同时包括原报告、多能力回归、实际打包程序导出、逐页图像及公开旧版失败复现。两个 Windows 程序另由同一桌面发行下载；`external-artifacts.json` 记录它们的路径、文件名、字节数和 SHA256。

1. 取得仓库完整源码并检出 `v2.20.1`（与 `v2.20.1-desktop.1` 指向同一交付提交），运行 `npm ci`。Python 需可导入 Pillow 和 pypdf；Poppler 的 `pdftoppm` 需在 PATH 中，或由 `MOTIONBENCH_PDFTOPPM` 指定。独立历史计分对比使用 Git 对象 `416897bd5022fbe3b7205c22b5d82f9078406b07`；旧 schema2 导出器测试还使用 `bdbb92cc0d6d914c6bcf5721d6eb65c2296c7d02`。旧版 PDF 失败复现还核对不可变的 `v2.20.0:MotionBench.html`；请保留该历史标签与对象。
2. 把证据包解压到仓库根目录，保持相对路径。从 `v2.20.1-desktop.1` 发行下载以下两个程序，核对 external 清单的字节数和 SHA256，再放到指定位置：

{destinations}

3. 运行 `python scripts/verify_delivery.py --require-ci`。验证器沿用已冻结的 CI 证据根目录，重建并校验 HTML、源文件、模型／浏览器／PDF／桌面及实际安装升级证据；默认不改验收文档。

`evidence-files.json` 记录所有其他 ZIP 成员的实际字节 SHA256，并附 external 清单。该清单本身不能递归包含自己的 SHA；打包器会逐字节复读它，ZIP 外的 `.receipt.json` 同时记录清单与整个 ZIP 的 SHA256。打包时所有成员均已重新解压读取、核对长度及哈希。仅包含冻结清单依赖和明确列出的验收文档、包内清单及本说明。
""".encode("utf-8")


def write_member(archive, relative, content):
    info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    archive.writestr(info, content, compresslevel=6)


def main():
    acceptance_bytes = workspace_file(ACCEPTANCE).read_bytes()
    acceptance = json.loads(acceptance_bytes.decode("utf-8-sig"))
    require(acceptance["version"] == VERSION and acceptance["desktopVersion"] == DESKTOP_VERSION and acceptance["recordedAt"], "Wrong or unfrozen acceptance record")
    require(all(acceptance[key] is True for key in ["pass", "localChecksPass", "ciChecksPass", "implementationComplete"]), "Complete local and CI acceptance is required")
    require(acceptance["passScope"] == "complete" and acceptance["ci"]["status"] == "passed", "CI acceptance is incomplete")
    dependencies, names = {}, set()
    for item in acceptance["dependencies"]:
        relative = item["path"]
        require(relative.casefold() not in names, "Duplicate dependency path: " + relative)
        names.add(relative.casefold())
        require(re.fullmatch(r"[a-f0-9]{64}", item["sha256"]) and isinstance(item["bytes"], int) and item["bytes"] >= 0, "Invalid dependency identity: " + relative)
        path = workspace_file(relative)
        require(path.stat().st_size == item["bytes"] and file_digest(path) == item["sha256"], "Stale or altered frozen dependency: " + relative)
        dependencies[relative] = item
    external = []
    for key, kind in [("installer", "setup"), ("portable", "portable")]:
        item = acceptance["ci"][key]
        require(dependencies.get(item["path"]) == item, "Executable is not the frozen CI dependency: " + key)
        asset = PurePosixPath(item["path"]).name
        expected = f"MotionBench-{DESKTOP_VERSION}-{'Setup' if kind == 'setup' else 'Portable'}-x64.exe"
        require(asset == expected, "Unexpected release executable name")
        external.append({**item, "assetName": asset, "releaseTag": RELEASE_TAG, "downloadUrl": f"https://github.com/ZekeNiu/MotionBench/releases/download/{RELEASE_TAG}/{asset}"})
    require({item["path"] for item in external} == {path for path in dependencies if PurePosixPath(path).suffix.lower() == ".exe"}, "Only the two frozen CI executables may be external")

    entries = {relative: item for relative, item in dependencies.items() if relative not in {item["path"] for item in external}}
    generated = {
        ACCEPTANCE: acceptance_bytes,
        ACCEPTANCE_MD: workspace_file(ACCEPTANCE_MD).read_bytes(),
        "external-artifacts.json": json_bytes({"schema": 1, "version": VERSION, "desktopVersion": DESKTOP_VERSION, "artifacts": external}),
        "REVIEW.md": review_instructions(external),
    }
    require(not set(generated) & set(entries), "Generated member collides with dependency allowlist")
    require(acceptance["artifact"]["sha256"].encode("ascii") in generated[ACCEPTANCE_MD], "Acceptance Markdown refers to another HTML")
    for relative, content in generated.items():
        inspect_text(relative, content)
        entries[relative] = detail(relative, content)
    inventory = {
        "schema": 1, "version": VERSION, "desktopVersion": DESKTOP_VERSION,
        "acceptance": detail(ACCEPTANCE, acceptance_bytes),
        "files": [entries[path] for path in sorted(entries)], "externalArtifacts": external,
        "selfEntry": "evidence-files.json",
        "selfVerification": "Compared byte-for-byte after ZIP creation; its SHA256 and the whole ZIP SHA256 are recorded in the external packaging receipt.",
    }
    generated["evidence-files.json"] = json_bytes(inventory)
    entries["evidence-files.json"] = detail("evidence-files.json", generated["evidence-files.json"])

    destination = ROOT / DESTINATION
    require(destination.resolve().is_relative_to(ROOT), "Output escaped workspace")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix="motionbench-evidence-", suffix=".zip.tmp", dir=destination.parent, delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        with zipfile.ZipFile(temporary_path, "w", allowZip64=True) as archive:
            for relative in sorted(entries):
                content = generated[relative] if relative in generated else workspace_file(relative).read_bytes()
                require(detail(relative, content) == entries[relative], "File changed while packaging: " + relative)
                inspect_text(relative, content)
                write_member(archive, relative, content)
        with zipfile.ZipFile(temporary_path, "r") as archive:
            require(len(archive.infolist()) == len(entries) and set(archive.namelist()) == set(entries), "ZIP member allowlist mismatch")
            for member in archive.infolist():
                sha = hashlib.sha256(); size = 0
                with archive.open(member, "r") as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        sha.update(block); size += len(block)
                require(size == entries[member.filename]["bytes"] and sha.hexdigest() == entries[member.filename]["sha256"], "ZIP member failed byte verification: " + member.filename)
            require(archive.read("evidence-files.json") == generated["evidence-files.json"], "ZIP inventory differs from generated bytes")
        for item in external:
            path = workspace_file(item["path"])
            require(path.stat().st_size == item["bytes"] and file_digest(path) == item["sha256"], "External executable changed during packaging")
        require(workspace_file(ACCEPTANCE).read_bytes() == acceptance_bytes and workspace_file(ACCEPTANCE_MD).read_bytes() == generated[ACCEPTANCE_MD], "Acceptance documents changed during packaging")
        os.replace(temporary_path, destination)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()
    receipt = {
        "schema": 1, "version": VERSION, "pass": True,
        "zip": {"path": DESTINATION, "sha256": file_digest(destination), "bytes": destination.stat().st_size},
        "archivedMembers": len(entries), "archivedBytes": sum(item["bytes"] for item in entries.values()),
        "allMembersReReadAndVerified": True, "acceptance": inventory["acceptance"],
        "inventory": entries["evidence-files.json"], "externalArtifacts": external,
    }
    destination.with_suffix(".receipt.json").write_bytes(json_bytes(receipt))
    print(json.dumps(receipt, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, UnicodeError, zipfile.BadZipFile) as error:
        print("FAIL evidence packaging: " + str(error), file=sys.stderr)
        raise SystemExit(1)
