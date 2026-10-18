#!/usr/bin/env python3
"""Nest native evidence in an existing report, preserving the exact asset set."""
import argparse
import json
import os
import tempfile
from pathlib import Path

from publish import (encoded_json, verify_local_session_smoke, verify_mac_package,
                     verify_packaged_recovery_smoke)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arch', choices=('arm64', 'x64'), required=True)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--local-session', type=Path, required=True)
    parser.add_argument('--native-binding', type=Path, required=True)
    args = parser.parse_args(argv)
    package = json.loads(args.package.read_text())
    local = json.loads(args.local_session.read_text())
    binding = json.loads(args.native_binding.read_text())
    verify_mac_package(package, package.get('version'), args.arch)
    verify_local_session_smoke(local, args.arch)
    verify_packaged_recovery_smoke(binding, package, args.arch)
    package.update(localSessionSmoke=local, packagedRecoverySmoke=binding)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=args.package.parent, prefix='.native-evidence-', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(encoded_json(package))
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(args.package)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
