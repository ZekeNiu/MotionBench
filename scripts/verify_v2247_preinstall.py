"""Require the complete 2.24.7 candidate evidence before actual installation."""
import json
import verify_v2247 as release

def main():
    result = release.public(ci=False)
    release.private(result, complete=False)
    print(json.dumps({'pass': True, 'version': release.VERSION, 'sourceHash': result['sourceHash'], 'candidateVerified': True, 'privateVerified': False}))

if __name__ == '__main__':
    main()
