#!/usr/bin/env python3
"""Assemble a fresh server directory from checked application and pinned official Node bytes."""
import argparse
import json
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile

from release_contract import (ARCHIVE_BYTES, ARCHIVE_SHA256, BINARY_SHA256, ENTRYPOINTS, LICENSE_SHA256,
                              NODE_URL, NODE_VERSION, digest, files, read_checksums, require,
                              validate_application, validate_runtime)


def unpack_nodes(nodes, target):
    read_checksums(nodes / 'SHASUMS256.txt')
    # Verify both entire archives before extracting any member; never trust tar paths.
    for arch, expected in ARCHIVE_SHA256.items():
        archive = nodes / f'node-v{NODE_VERSION}-{arch}.tar.xz'
        require(archive.is_file() and not archive.is_symlink() and archive.stat().st_size == ARCHIVE_BYTES[arch] and digest(archive) == expected,
                f'Pinned official Node archive mismatch: {archive.name}')
    records = []
    for arch, expected in ARCHIVE_SHA256.items():
        name = f'node-v{NODE_VERSION}-{arch}.tar.xz'
        archive = nodes / name
        folder = target / arch
        folder.mkdir(parents=True)
        with tarfile.open(archive, 'r:xz') as tar:
            for relative, destination in (('bin/node', 'node'), ('LICENSE', 'LICENSE')):
                members = [member for member in tar.getmembers() if member.name == name[:-7] + '/' + relative]
                require(len(members) == 1 and members[0].isfile(), f'Invalid official archive member: {relative}')
                stream = tar.extractfile(members[0])
                require(stream is not None, f'Cannot read official archive member: {relative}')
                with stream, (folder / destination).open('xb') as output:
                    shutil.copyfileobj(stream, output)
        (folder / 'node').chmod(0o755)
        require(digest(folder / 'node') == BINARY_SHA256[arch], f'Pinned Node binary mismatch: {arch}')
        require(digest(folder / 'LICENSE') == LICENSE_SHA256, f'Pinned Node license mismatch: {arch}')
        records.append({'arch': arch, 'filename': name, 'bytes': archive.stat().st_size,
                        'sha256': expected, 'url': NODE_URL + name, 'node_sha256': BINARY_SHA256[arch],
                        'node_bytes': (folder / 'node').stat().st_size})
    shutil.copy2(nodes / 'SHASUMS256.txt', target / 'SHASUMS256.txt')
    (target / 'NODE-RUNTIMES.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')
    validate_runtime(target)


def assemble(app, out, nodes=None, prior=None):
    source = Path(__file__).resolve().parent
    require(not out.exists() and not out.is_symlink(), 'Output must be a fresh directory')
    require(not out.is_relative_to(app), 'Output must not be inside the application input')
    manifest = validate_application(app)
    for name in ENTRYPOINTS:
        require((source / name).is_file(), f'Missing launch entrypoint: {name}')
    if prior is not None:
        validate_runtime(prior)
    # Use disposable staging so bad provenance or interrupted copy never leaves a release directory.
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.qingdan-server-stage-', dir=out.parent) as scratch:
        staged = Path(scratch) / 'server'
        staged.mkdir()
        for name in ENTRYPOINTS:
            shutil.copy2(source / name, staged / name)
            (staged / name).chmod(0o755)
        shutil.copytree(source / 'launcher', staged / 'launcher')
        readme = (source / 'README-运行.txt').read_text(encoding='utf-8')
        readme = readme.replace('{{VERSION}}', manifest['version']).replace('{{SOURCE_SNAPSHOT_SHA256}}', manifest['source_snapshot_sha256'])
        (staged / '先读我.txt').write_text(readme, encoding='utf-8')
        shutil.copytree(app, staged / 'app')
        if nodes is not None:
            unpack_nodes(nodes, staged / 'runtime')
        else:
            shutil.copytree(prior, staged / 'runtime')
            # Reuse just the fixed contract, never an arbitrary prior runtime payload.
            allowed = {'SHASUMS256.txt', 'NODE-RUNTIMES.json'} | {f'{arch}/{name}' for arch in ARCHIVE_SHA256 for name in ('node', 'LICENSE')}
            require(set(files(staged / 'runtime')) == allowed, 'Unlisted files in verified runtime input')
        validate_application(staged / 'app')
        validate_runtime(staged / 'runtime')
        inventory = files(staged)
        server_manifest = {'product': 'qingdan-server-web', 'version': manifest['version'],
                           'application_source_snapshot_sha256': manifest['source_snapshot_sha256'],
                           'platforms': ['linux-x64-glibc', 'darwin-arm64'],
                           'runtime': f'official Node.js {NODE_VERSION}',
                           'bundled_dependencies': 'package-lock production-only installation',
                           'files_sha256': inventory,
                           'boundaries': ['Final archive must be independently extracted and tested with synthetic local/accounts data.',
                                          'Both official Node payloads are pinned; native execution must be reported separately for each platform.',
                                          'No real credentials or external deployment configured.']}
        (staged / 'SERVER-MANIFEST.json').write_text(json.dumps(server_manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        require(not out.exists(), 'Output appeared during assembly; refusing to replace it')
        staged.rename(out)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', required=True)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--nodes')
    inputs.add_argument('--verified-runtime')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        result = assemble(Path(args.app).resolve(), Path(args.output).resolve(),
                          Path(args.nodes).resolve() if args.nodes else None,
                          Path(args.verified_runtime).resolve() if args.verified_runtime else None)
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError) as error:
        parser.exit(1, f'Assembly failed: {error}\n')
    print(result)


if __name__ == '__main__':
    main()
