"""Record the explicit legacy-model parity run without changing its test inputs."""
from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/implementation-2.24.7/resumed'
RUNNER = 'tests/comparison-trend-tests.cjs'
BASELINE = 'f4f4fd40338726ad426ed1b323f31f6ea619d480'


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def module_hashes():
    return {file.relative_to(ROOT).as_posix(): digest(file)
            for file in sorted((ROOT / 'src').glob('ringside-*.js'))}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    receipt, log = OUT / 'model-baseline.json', OUT / 'model-baseline.log'
    assert not receipt.exists() and not log.exists(), 'Preserve prior parity evidence'
    source, producer, test, modules = (digest(ROOT / 'MotionBench.html'), digest(__file__),
                                       digest(ROOT / RUNNER), module_hashes())
    baseline_model = subprocess.check_output(['git', 'show', BASELINE + ':src/ringside-model.js'], cwd=ROOT)
    run = subprocess.run(['node', RUNNER, '--model-baseline'], cwd=ROOT,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log.write_bytes(run.stdout)
    stdout = run.stdout.decode('utf-8', errors='replace')
    counts = re.search(r'^(\d+) comparison trend checks passed; (\d+) failed\s*$', stdout, re.M)
    passed = len(re.findall(r'^PASS ', stdout, re.M))
    unchanged = (source == digest(ROOT / 'MotionBench.html') and producer == digest(__file__)
                 and test == digest(ROOT / RUNNER) and modules == module_hashes())
    result = {
        'pass': run.returncode == 0 and counts is not None and counts.groups() == ('23', '0')
                and passed == 23 and unchanged,
        'sourceHash': source, 'producerSha256': producer, 'runnerSha256': test,
        'baselineCommit': BASELINE, 'baselineModelSha256': hashlib.sha256(baseline_model).hexdigest(),
        'moduleHashes': modules, 'sourceUnchanged': unchanged, 'exitCode': run.returncode,
        'checksPassed': passed, 'checksFailed': int(counts.group(2)) if counts else None,
        'log': {'file': log.relative_to(ROOT).as_posix(), 'sha256': digest(log)},
    }
    receipt.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'pass': result['pass'], 'checksPassed': passed, 'sourceHash': source}))
    if not result['pass']:
        raise SystemExit(run.returncode or 1)


if __name__ == '__main__':
    main()
