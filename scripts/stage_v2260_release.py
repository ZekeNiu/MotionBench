"""Validate and stage the ten public MotionBench 2.26.0 release assets.

This command never builds, installs, launches, uploads, or reads a user profile.
Both modes require committed, clean source and the final public acceptance files.
--check-only performs the same input validation without creating any files.
"""
from __future__ import annotations

import argparse
import base64
import datetime
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION = "2.26.0"
DESKTOP_VERSION = VERSION + "-desktop.1"
HTML_SHA256 = "7e61a98dc9d2aba88520765756d2d14369d15b7793d92d00b311a06babdeb3b5"
ACCEPTANCE_JSON = f"docs/acceptance-{VERSION}.json"
ACCEPTANCE_MD = f"docs/acceptance-{VERSION}.md"
DEFAULT_WORK = ROOT / "output/release/2.26.0-local"
SOURCE_PATHS = ["src", "desktop", "vendor", "MotionBench.html", "body-map-front.png",
                "package.json", "package-lock.json", "electron-builder.yml", "scripts",
                "tests", ".github/workflows", ACCEPTANCE_JSON, ACCEPTANCE_MD]
HASH_PATTERN = re.compile(r"^[a-f0-9]{64}$")
PRIVATE_PATH = re.compile(r"[A-Za-z]:[\\/]|\\\\|file://|/(?:Users|home|mnt|private|tmp|var)/", re.I)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def digest(path, algorithm="sha256"):
    result = hashlib.new(algorithm)
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def git(*arguments):
    return subprocess.run(["git", *arguments], cwd=ROOT, check=True, capture_output=True).stdout


def clean_commit():
    require(not git("status", "--porcelain", "--untracked-files=all").strip(),
            "Commit final source, staging script and public acceptance documents first")
    return git("rev-parse", "HEAD").decode("ascii").strip()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def public_text(value, label):
    require(isinstance(value, str) and bool(value.strip()) and not PRIVATE_PATH.search(value),
            label + " must be public text without machine/profile paths")
    require(not re.search(r"(?:^|[/\\])(?:private|backups?|user-data)(?:[/\\]|$)", value, re.I),
            label + " contains a private evidence path")
    return value


def inspect_package(directory):
    # Read-only archive inspection; do not invoke the receipt producer here.
    javascript = r"""
const fs=require('node:fs'),path=require('node:path'),asar=require('@electron/asar'),yaml=require('js-yaml');
const directory=process.argv[1],archive=path.join(directory,'win-unpacked/resources/app.asar');
const extract=name=>asar.extractFile(archive,path.normalize(name));
const html=extract('MotionBench.html'),source=fs.readFileSync('MotionBench.html');
const marker=/window\.RingsideBuild=Object\.freeze\((\{[^\n]+\})\);/.exec(html.toString('utf8'));
const files=asar.listPackage(archive).map(name=>name.replace(/\\/g,'/').replace(/^\//,''))
 .filter(name=>!asar.statFile(archive,path.normalize(name)).files).sort();
const allowed=/^(?:package\.json|MotionBench\.html|desktop\/[a-z0-9-]+\.cjs|desktop\/assets\/motionbench\.(?:ico|png)|vendor\/[a-z0-9-]+\.LICENSE\.txt|vendor\/versions\.json)$/;
for(const name of files){if(name.startsWith('node_modules/'))continue;
 if(!allowed.test(name))throw Error('Unexpected packaged source asset: '+name);
 if(name!=='package.json'&&!extract(name).equals(fs.readFileSync(name)))throw Error('Packaged source differs: '+name);}
console.log(JSON.stringify({htmlIdentical:html.equals(source),build:marker?JSON.parse(marker[1]):null,
 package:JSON.parse(extract('package.json').toString('utf8')),files,
 builder:yaml.load(fs.readFileSync('electron-builder.yml','utf8')),
 updater:yaml.load(fs.readFileSync(path.join(directory,'desktop.yml'),'utf8')),
 appUpdater:yaml.load(fs.readFileSync(path.join(directory,'win-unpacked/resources/app-update.yml'),'utf8'))}));
"""
    completed = subprocess.run(["node", "-e", javascript, str(directory)], cwd=ROOT,
                               check=True, capture_output=True, encoding="utf-8")
    return json.loads(completed.stdout)


def public_verification(acceptance):
    scope = acceptance.get("scope")
    if isinstance(scope, str):
        scope = [scope]
    require(isinstance(scope, list) and bool(scope), "Acceptance scope must describe the public checks")
    scope = [public_text(item, "Acceptance scope") for item in scope]
    summary = {"scope": scope}
    for field in ("unitSuites", "unitChecks"):
        value = acceptance.get(field)
        require(isinstance(value, int) and not isinstance(value, bool) and value > 0,
                "Missing positive acceptance count: " + field)
        summary[field] = value
    evidence = acceptance.get("evidence")
    require(isinstance(evidence, list) and bool(evidence), "Missing public test evidence hashes")
    summary["evidence"] = []
    for item in evidence:
        require(isinstance(item, dict) and HASH_PATTERN.fullmatch(item.get("sha256", "")),
                "Invalid public evidence hash")
        name = public_text(item.get("file"), "Public evidence reference")
        relative = Path(name)
        require(not relative.is_absolute() and ".." not in relative.parts,
                "Public evidence must be a repository-relative file")
        source = (ROOT / relative).resolve()
        require(source.is_relative_to(ROOT.resolve()) and source.is_file(), "Public evidence file missing")
        require(digest(source) == item["sha256"], "Public acceptance evidence changed: " + name)
        # Only hashes/counts enter provenance. Do not copy receipts, their
        # contents, machine paths or private-data summaries into the release.
        entry = {"sha256": item["sha256"]}
        if "checks" in item:
            require(isinstance(item["checks"], int) and not isinstance(item["checks"], bool)
                    and item["checks"] > 0, "Invalid public evidence check count")
            entry["checks"] = item["checks"]
        summary["evidence"].append(entry)
    return summary


def checked_inputs(directory, receipt_path):
    commit = clean_commit()
    package = read_json(ROOT / "package.json")
    lock = read_json(ROOT / "package-lock.json")
    require(package["version"] == VERSION and lock["version"] == VERSION and
            lock["packages"][""]["version"] == VERSION, "Source/lock version differs")
    source_hash = digest(ROOT / "MotionBench.html")
    require(source_hash == HTML_SHA256, "HTML differs from the final accepted build")
    archive = directory / "win-unpacked/resources/app.asar"
    archive_hash = digest(archive)
    receipt = read_json(receipt_path)
    require(receipt.get("version") == DESKTOP_VERSION and receipt.get("webVersion") == VERSION,
            "Package receipt version differs")
    require(receipt.get("directoryOnly") is False and receipt.get("updaterConfigurationPresent") is True,
            "Package receipt must describe a completed installer build")
    require(receipt.get("archiveSha256") == archive_hash, "Package receipt belongs to another ASAR")
    require(isinstance(receipt.get("files"), list) and len(receipt["files"]) == len(set(receipt["files"])) > 0,
            "Package receipt runtime inventory is invalid")
    inspected = inspect_package(directory)
    require(inspected["htmlIdentical"] and inspected["build"]["version"] == VERSION,
            "Packaged HTML/build version differs")
    require(inspected["files"] == sorted(receipt["files"]), "ASAR inventory differs from package receipt")
    require(inspected["package"]["name"] == package["name"] and inspected["package"]["main"] == "desktop/main.cjs",
            "Packaged application identity differs")
    for metadata in (inspected["package"], inspected["builder"]["extraMetadata"]):
        require(metadata["version"] == DESKTOP_VERSION and metadata["webVersion"] == VERSION,
                "Packaged/builder version differs")
    for key, value in {"provider": "github", "owner": "ZekeNiu", "repo": "MotionBench", "channel": "desktop"}.items():
        require(inspected["appUpdater"].get(key) == value, "Packaged updater identity differs: " + key)

    setup = directory / f"MotionBench-{DESKTOP_VERSION}-Setup-x64.exe"
    portable = directory / f"MotionBench-{DESKTOP_VERSION}-Portable-x64.exe"
    sources = [ROOT / "MotionBench.html", archive, setup, Path(str(setup) + ".blockmap"), portable,
               directory / "desktop.yml", ROOT / ACCEPTANCE_JSON, ROOT / ACCEPTANCE_MD]
    assets = []
    for source in sources:
        require(source.is_file() and source.stat().st_size > 0, "Missing or empty release asset: " + source.name)
        assets.append({"file": source.name, "bytes": source.stat().st_size, "sha256": digest(source)})
    by_name = {item["file"]: item for item in assets}
    setup_sha512 = base64.b64encode(bytes.fromhex(digest(setup, "sha512"))).decode("ascii")
    updater = inspected["updater"]
    require(updater["version"] == DESKTOP_VERSION and updater["path"] == setup.name and
            updater["sha512"] == setup_sha512 and len(updater["files"]) == 1,
            "desktop.yml version, installer or checksum differs")
    entry = updater["files"][0]
    require(entry["url"] == setup.name and entry["size"] == setup.stat().st_size and entry["sha512"] == setup_sha512,
            "desktop.yml installer URL, size or SHA512 differs")

    acceptance = read_json(ROOT / ACCEPTANCE_JSON)
    require(acceptance.get("pass") is True and acceptance.get("version") == VERSION and
            acceptance.get("desktopVersion") == DESKTOP_VERSION, "Public acceptance status/version differs")
    require(acceptance.get("artifact") == by_name["MotionBench.html"], "Public acceptance HTML identity differs")
    accepted_package = acceptance.get("package", {})
    for key, expected in {"archiveSha256": archive_hash, "assets": len(receipt["files"]),
                          "installerSha256": by_name[setup.name]["sha256"],
                          "portableSha256": by_name[portable.name]["sha256"]}.items():
        require(accepted_package.get(key) == expected, "Public acceptance package identity differs: " + key)
    verification = public_verification(acceptance)
    markdown = (ROOT / ACCEPTANCE_MD).read_text(encoding="utf-8-sig")
    require(VERSION in markdown and source_hash in markdown, "Acceptance markdown version/hash missing")
    public_text(markdown, "Acceptance markdown")
    public_text(json.dumps(acceptance, ensure_ascii=False), "Acceptance JSON")
    tracked = sorted(name for name in git("ls-files", "-z", "--", *SOURCE_PATHS).decode("utf-8").split("\0") if name)
    require(all(name in tracked for name in (ACCEPTANCE_JSON, ACCEPTANCE_MD, "MotionBench.html", "scripts/stage_v2260_release.py")),
            "Final HTML, acceptance and staging script must be committed")
    source_files = [{"file": name, "bytes": (ROOT / name).stat().st_size, "sha256": digest(ROOT / name)} for name in tracked]
    require(clean_commit() == commit, "Source commit changed during verification")
    for source, asset in zip(sources, assets):
        require(digest(source) == asset["sha256"], "Release input changed during inspection: " + asset["file"])
    provenance = {"version": VERSION, "desktopVersion": DESKTOP_VERSION, "commit": commit,
                  "sourceHash": source_hash, "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "assets": assets, "sourceFiles": source_files, "verification": verification,
                  "packageVerification": {"archiveSha256": archive_hash, "runtimeAssets": len(receipt["files"]),
                                          "receiptSha256": digest(receipt_path)}, "privateDataIncluded": False}
    return provenance, sources


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--package-dir", type=Path, default=DEFAULT_WORK / "desktop")
    parser.add_argument("--package-receipt", type=Path)
    arguments = parser.parse_args()
    directory = arguments.package_dir.resolve()
    receipt = (arguments.package_receipt or directory.parent / "package-check.json").resolve()
    destination = DEFAULT_WORK / "public-downloads"
    require(not destination.exists(), "Preserve existing public-downloads; refusing to overwrite")
    provenance, sources = checked_inputs(directory, receipt)
    if arguments.check_only:
        print(json.dumps({"pass": True, "staged": False, "commit": provenance["commit"],
                          "sourceHash": provenance["sourceHash"], "assets": 10}))
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".public-downloads-staging-", dir=destination.parent))
    try:
        for source, entry in zip(sources, provenance["assets"]):
            target = temporary / entry["file"]
            shutil.copyfile(source, target)
            require(digest(source) == digest(target) == entry["sha256"], "Input or staged bytes changed: " + entry["file"])
        write_json(temporary / "build-provenance.json", provenance)
        names = [entry["file"] for entry in provenance["assets"]] + ["build-provenance.json"]
        (temporary / "SHA256SUMS.txt").write_text("".join(digest(temporary / name) + "  " + name + "\n" for name in names), encoding="ascii")
        names.append("SHA256SUMS.txt")
        require(len(names) == len(set(names)) == 10 and sorted(item.name for item in temporary.iterdir()) == sorted(names),
                "Wrong ten-asset public allowlist")
        require(clean_commit() == provenance["commit"], "Source changed while staging")
        for entry in provenance["sourceFiles"]:
            require(digest(ROOT / entry["file"]) == entry["sha256"], "Source bytes changed while staging: " + entry["file"])
        require(not destination.exists(), "Another staged release appeared; refusing overwrite")
        temporary.rename(destination)
        print(json.dumps({"pass": True, "staged": True, "commit": provenance["commit"], "assets": 10,
                          "sourceHash": provenance["sourceHash"], "destination": destination.relative_to(ROOT).as_posix()}))
    except Exception:
        print("Incomplete staging preserved at " + temporary.relative_to(ROOT).as_posix())
        raise


if __name__ == "__main__":
    main()
