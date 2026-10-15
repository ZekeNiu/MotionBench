"""Complete only the recorded final evidence-read race without launching the app."""
import json
from pathlib import Path

import verify_v2242_system as system


def main():
    source_hash = system.digest(system.ROOT / 'MotionBench.html')
    manifest = system.checkpoint_proof()
    file = system.CHECKPOINT / 'verification/reopened/completion.json'
    system.require(not file.exists(), 'Preserve any existing standalone completion evidence')
    expected_primary = system.digest(file.parent / 'receipt.json')
    evidence = system.build_reopen_completion(source_hash, manifest)
    system.require(system.digest(file.parent / 'receipt.json') == expected_primary, 'Original failed receipt changed during read-only completion')
    file.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    system.require(system.reopen_completion_proof(source_hash, manifest) == evidence, 'Standalone completion readback differs')
    print(json.dumps({'pass': True, 'primaryPass': False, 'completionChecks': len(evidence['checks']), 'normalClose': evidence['normalClose'], 'counts': evidence['counts'], 'file': str(file), 'sha256': system.digest(file)}))


if __name__ == '__main__':
    main()
