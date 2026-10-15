"""Read-only adversarial checks for the private actual-startup continuation gate."""
from pathlib import Path
import ast
import copy
import json
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import verify_v2243 as v


def main():
    manifest = v.read(v.CHECKPOINT / 'manifest.json')
    source = v.digest(v.ROOT / 'MotionBench.html')
    prior = v.CHECKPOINT / 'verification/installed-startup-time-failure'
    original_read, original_digest = v.read, v.digest
    protected = {name: original_digest(prior / name) for name in v.PRIOR_STARTUP_HASHES}
    passed = []

    def check(label, operation):
        operation()
        passed.append(label)

    def reject(label, operation):
        try:
            operation()
        except (AssertionError, ValueError, RuntimeError, KeyError, TypeError, SystemExit):
            passed.append(label)
            return
        raise AssertionError('Accepted tampered evidence: ' + label)

    def modified_read(file, mutate, operation):
        def replacement(name):
            result = original_read(name)
            if v.physical.same_path(v.ROOT / name, v.ROOT / file):
                result = copy.deepcopy(result)
                mutate(result)
            return result
        with patch.object(v, 'read', replacement):
            operation()

    check('Archived install-time verifier remains bound to the actual installation', lambda: v.installation_proof(manifest))
    check('Original failed startup and its Explorer physical context verify unchanged', lambda: v.prior_startup_proof(source, manifest))
    for name in v.PRIOR_STARTUP_HASHES:
        def altered_hash(name=name):
            with patch.object(v, 'digest', lambda path: '0' * 64 if v.physical.same_path(path, prior / name) else original_digest(path)):
                v.prior_startup_proof(source, manifest)
        reject('Reject changed archived bytes: ' + name, altered_hash)
    mutations = [
        ('Reject another prior producer', lambda row: row.update(runnerSha256='0' * 64)),
        ('Reject another prior source', lambda row: row.update(sourceHash='0' * 64)),
        ('Reject another prior plan', lambda row: row.update(planSha256='0' * 64)),
        ('Reject another prior baseline', lambda row: row.update(baselineSnapshotSha256='0' * 64)),
        ('Reject launch path redirected to another stage', lambda row: row['launchReceipt'].update(file=str(prior / 'native-launch.json'))),
        ('Reject unconfirmed native exit', lambda row: row['closeEvidence'].update(exited=False)),
    ]
    for label, mutate in mutations:
        reject(label, lambda mutate=mutate: modified_read(prior / 'receipt.json', mutate, lambda: v.prior_startup_proof(source, manifest)))
    for label, file, mutate in [
        ('Reject installation attributed to the new verifier', v.OUT + 'system-installation.json', lambda row: row.update(verifierSha256=v.digest(Path(v.__file__)))),
        ('Reject archived verifier with an unbound source', v.OUT + 'install-preflight-producer.json', lambda row: row.update(sourceHash='0' * 64)),
        ('Reject a forged archived-verifier checksum', v.OUT + 'install-preflight-producer.json', lambda row: row['archive'].update(sha256='0' * 64)),
        ('Reject an archive bound to another installation receipt', v.OUT + 'install-preflight-producer.json', lambda row: row['installationReceipt'].update(sha256='0' * 64)),
        ('Reject an archive bound to another Explorer launch', v.OUT + 'install-preflight-producer.json', lambda row: row['installationLaunch'].update(sha256='0' * 64)),
    ]:
        reject(label, lambda file=file, mutate=mutate: modified_read(file, mutate, lambda: v.installation_proof(manifest)))

    def public_gate_unchanged():
        def functions(file):
            return {node.name: ast.dump(node, include_attributes=False) for node in ast.parse(file.read_text(encoding='utf-8')).body if isinstance(node, ast.FunctionDef)}
        old = functions(v.ROOT / (v.OUT + 'install-preflight-producer.py'))
        current = functions(Path(v.__file__))
        for name in ('package_proof', 'browser_proof', 'checkpoint_proof', 'baseline_proof', 'plan_proof', 'calculation_check', 'native_proof', 'visual_proof', 'shortcut_proof', 'main'):
            assert old[name] == current[name], name
    check('Public and candidate gates retain their original function semantics', public_gate_unchanged)
    assert protected == {name: original_digest(prior / name) for name in protected}
    result = {'pass': True, 'sourceHash': source, 'verifierSha256': v.digest(Path(v.__file__)), 'runnerSha256': v.digest(Path(__file__)), 'checks': passed, 'errors': [], 'archivedEvidenceUnchanged': True}
    target = v.ROOT / (v.OUT + 'actual-verifier-negative-checks.json')
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'pass': True, 'checks': len(passed), 'receipt': str(target)}))


if __name__ == '__main__':
    main()
