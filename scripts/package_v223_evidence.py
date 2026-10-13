"""Bundle exact public/synthetic delivery evidence, excluding private user profiles."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'output/release/2.23.0'
DEST.mkdir(parents=True, exist_ok=True)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(ok, message):
    if not ok:
        raise SystemExit(message)


acceptance = json.loads((ROOT / 'docs/acceptance-2.23.0.json').read_text(encoding='utf-8'))
require(acceptance['pass'] and acceptance['version'] == '2.23.0', 'Final acceptance required')
members = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode('utf-8').split('\0')) - {''}
for folder in ('src', 'tests', 'scripts', 'docs'):
    for file in (ROOT / folder).rglob('*'):
        if file.is_file() and '__pycache__' not in file.parts and file.suffix in {'.js', '.css', '.html', '.cjs', '.py', '.md', '.json', '.jsonl'}:
            members.add(file.relative_to(ROOT).as_posix())
# Follow only final receipts and their artifacts. Never traverse user profiles or
# include stale exploratory PDFs that happen to remain beside a final receipt.
receipts = list(acceptance['proofs']) + [
    'output/tests/v223/final/unit-results.json', 'output/tests/v223/desktop-unit/results.json',
    'output/implementation-2.23.0/final-source-render/render-review.json',
    'output/implementation-2.23.0/visual-review.json']
for relative in receipts:
    members.add(relative)
    data = json.loads((ROOT / relative).read_text(encoding='utf-8-sig'))
    def collect(value):
        if isinstance(value, dict):
            if value.get('sha256') and (value.get('file') or value.get('path')):
                file = value.get('file') or value['path']
                logical = Path(file).resolve().relative_to(ROOT).as_posix() if Path(file).is_absolute() else file if file.startswith('output/') else (Path(relative).parent / file).as_posix()
                members.add(logical)
            if value.get('log') and value.get('logSha256'):
                members.add(value['log'])
            for item in value.values():
                collect(item)
        elif isinstance(value, list):
            for item in value:
                collect(item)
    collect(data)
for filename in ('团队与纵向模拟资料库.json', '团队与纵向模拟资料库.jsonl', 'generation-evidence.json', 'async-model-integrity.json'):
    members.add('output/comparison-demo/' + filename)
for file in ('output/desktop-package/package-check.json', 'output/implementation-2.23.0/visual-review.json',
             'output/playwright/v223/ai-facts-diagnostic/controller-full-proof.json',
             'output/implementation-2.23.0/local-installation.json', 'dist-desktop/win-unpacked/resources/app.asar',
             'dist-desktop/win-unpacked/MotionBench.exe'):
    members.add(file)
external = []
for name in ('MotionBench-2.23.0-desktop.1-Setup-x64.exe', 'MotionBench-2.23.0-desktop.1-Portable-x64.exe'):
    file = ROOT / 'dist-desktop' / name
    external.append({'assetName': name, 'path': file.relative_to(ROOT).as_posix(), 'bytes': file.stat().st_size, 'sha256': sha(file.read_bytes())})
text_extensions = {'.json', '.jsonl', '.md', '.txt', '.py', '.cjs', '.js', '.css', '.html', '.yml', '.yaml', '.ps1', '.xml', '.csv', '.svg'}
secret = re.compile(r'(?:\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)')
entries = []
target = DEST / 'MotionBench-2.23.0-evidence.zip'
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for relative in sorted(members):
        logical = PurePosixPath(relative)
        require(not logical.is_absolute() and '..' not in logical.parts and not any(part in {'userdata', 'user-data', 'verification', 'node_modules', '.git'} for part in logical.parts), 'Excluded path: ' + relative)
        file = ROOT / relative
        require(not file.is_symlink() and file.resolve().is_relative_to(ROOT) and file.is_file(), 'Invalid/missing member: ' + relative)
        require(file.name not in {'ai-settings.dat', 'desktop-preferences.json', 'original-business.json'} and file.suffix.lower() not in {'.pem', '.key', '.pfx'}, 'Private content excluded')
        data = file.read_bytes()
        if file.suffix.lower() in text_extensions:
            matches = secret.findall(data.decode('utf-8-sig'))
            # The pre-existing browser test deliberately uses this invalid,
            # literal synthetic credential to test encrypted settings.
            allowed = {'sk-synthetic-secret-for-browser-verification-only'} if relative == 'tests/ai-service-browser-tests.cjs' else set()
            require(all(value in allowed for value in matches), 'Credential-like content: ' + relative)
        archive.writestr(relative, data)
        entries.append({'path': relative, 'bytes': len(data), 'sha256': sha(data)})
    readme = ('# MotionBench 2.23.0 evidence\n\n'
              'All application data in public test artifacts are synthetic. Original user profiles and raw user measurements are excluded.\n\n'
              'Extract at the repository root, keeping paths. Download the separate Setup and Portable assets and compare external-artifacts.json.\n'
              'Use Node 24, npm ci, Python with Pillow/pypdf and run python scripts/verify_delivery.py. '
              'The default verification binds source, tests, PDF images and Windows package. --require-private additionally needs the local protected checkpoint.\n'
              'evidence-files.json lists exact bytes and hashes. Source Git tags/branch and build-provenance.json identify the delivery commit.\n')
    archive.writestr('EVIDENCE-README.md', readme)
    archive.writestr('external-artifacts.json', json.dumps(external, indent=2))
    archive.writestr('evidence-files.json', json.dumps(entries, ensure_ascii=False, indent=2))
with zipfile.ZipFile(target) as archive:
    require(archive.testzip() is None, 'ZIP CRC failed')
    for entry in entries:
        data = archive.read(entry['path'])
        require(len(data) == entry['bytes'] and sha(data) == entry['sha256'], 'ZIP readback mismatch')
receipt = {'file': target.name, 'sha256': sha(target.read_bytes()), 'bytes': target.stat().st_size,
           'sourceHash': acceptance['sourceHash'], 'files': len(entries), 'external': external, 'readbackVerified': True, 'privateProfilesIncluded': False}
(DEST / 'evidence-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
print(json.dumps(receipt))
