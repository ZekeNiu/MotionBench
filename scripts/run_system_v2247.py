"""Launch the actual installed app via Explorer and run protected CDP checks."""
from pathlib import Path
import base64, json, os, socket, subprocess, sys, time, urllib.request
ROOT = Path(__file__).resolve().parents[1]
CP = Path(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261020-system-before-2.24.7')
PS = Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
PWSH = Path(r'C:\Users\ZekeNiu\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe')
def read(file): return json.loads(file.read_text(encoding='utf-8-sig'))
def broker(file, args, style, receipt):
    quote = lambda value: "'" + str(value).replace("'", "''") + "'"
    command = '& ' + quote(ROOT / 'scripts/invoke-from-desktop.ps1') + ' -FilePath ' + quote(file) + ' -Arguments ' + quote(args) + ' -WorkingDirectory ' + quote(ROOT) + ' -WindowStyle ' + quote(style) + ' -ReceiptPath ' + quote(receipt)
    subprocess.run([str(PWSH), '-NoProfile', '-EncodedCommand', base64.b64encode(command.encode('utf-16le')).decode()], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
def wait_json(file):
    end = time.monotonic() + 60
    while time.monotonic() < end:
        try: return read(file)
        except (OSError, ValueError): time.sleep(.25)
    raise TimeoutError(str(file))
def main():
    mode = sys.argv[1]; assert mode in ('installed', 'reopened')
    assert read(ROOT / 'output/implementation-2.24.7/resumed/system-installation.json')['pass']
    directory = CP / 'verification' / mode; directory.mkdir(parents=True, exist_ok=True)
    assert not (directory / 'receipt.json').exists()
    before = directory / 'before-physical.json'
    broker(PS, f'-NoProfile -ExecutionPolicy Bypass -File "{ROOT / "output/implementation-2.24.2/inspect-system-profile.ps1"}" -Destination "{before}"', 'Hidden', directory / 'probe-launch.json')
    physical = wait_json(before)
    subprocess.run([str(PWSH), '-NoProfile', '-Command', f'$p=Get-Process -Id {int(physical["processId"])} -ErrorAction SilentlyContinue;if($p){{Wait-Process -Id $p.Id -Timeout 60 -ErrorAction Stop}};exit 0'], check=True, stdout=subprocess.DEVNULL)
    with socket.socket() as server: server.bind(('127.0.0.1', 0)); port = server.getsockname()[1]
    launch = directory / 'native-launch.json'
    broker(Path(r'D:\Application\Strength&Conditioning\MotionBench\MotionBench.exe'), f'--remote-debugging-port={port}', 'Normal', launch)
    end = time.monotonic() + 60
    while True:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version', timeout=2) as response: json.load(response)
            break
        except (OSError, ValueError):
            if time.monotonic() > end: raise TimeoutError('Actual desktop attachment unavailable')
            time.sleep(.25)
    runner = 'tests/desktop-system-v2247-reopened.cjs' if mode == 'reopened' else 'tests/desktop-system-v2247.cjs'
    subprocess.run(['node', runner, mode, '--cdp-port', str(port), '--launch-receipt', str(launch), '--physical-before', str(before)], cwd=ROOT, check=True)
if __name__ == '__main__': main()
