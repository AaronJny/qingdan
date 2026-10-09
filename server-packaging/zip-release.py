#!/usr/bin/env python3
"""Write a new ZIP with an exact verified inventory and preserved executable permissions."""
import argparse
import json
from pathlib import Path
import stat
import zipfile

from release_contract import (ENTRYPOINTS, digest, read_json, require, validate_hash, verify_file_map)


def create_zip(root, out):
    require(not out.exists() and not out.is_symlink(), 'Do not overwrite prior artifacts')
    require(not out.is_relative_to(root), 'ZIP output must be outside the input directory')
    manifest = read_json(root / 'SERVER-MANIFEST.json')
    require(manifest.get('product') == 'qingdan-server-web', 'Unexpected server product')
    validate_hash(manifest.get('application_source_snapshot_sha256'), 'application source snapshot')
    verify_file_map(root, manifest.get('files_sha256'), exclude=('SERVER-MANIFEST.json',))
    required_executable = ENTRYPOINTS + ('runtime/linux-x64/node', 'runtime/darwin-arm64/node')
    for name in required_executable:
        require(name in manifest['files_sha256'] and (root / name).stat().st_mode & 0o111,
                f'Missing executable entrypoint: {name}')
    created = False
    try:
        with out.open('xb') as stream:
            created = True
            with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                for name in sorted((*manifest['files_sha256'], 'SERVER-MANIFEST.json')):
                    archive.write(root / name, 'qingdan-server/' + name)
        with zipfile.ZipFile(out) as archive:
            require(archive.testzip() is None, 'ZIP CRC integrity check failed')
            for name in required_executable:
                mode = archive.getinfo('qingdan-server/' + name).external_attr >> 16
                require(stat.S_ISREG(mode) and mode & 0o111, f'ZIP executable permission missing: {name}')
        return {'path': str(out), 'bytes': out.stat().st_size, 'sha256': digest(out),
                'source_snapshot_sha256': manifest['application_source_snapshot_sha256'],
                'version': manifest['version'], 'files': len(manifest['files_sha256']) + 1}
    except BaseException:
        if created:
            out.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory')
    parser.add_argument('zip')
    args = parser.parse_args()
    try:
        result = create_zip(Path(args.directory).resolve(), Path(args.zip).resolve())
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        parser.exit(1, f'ZIP packaging failed: {error}\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
