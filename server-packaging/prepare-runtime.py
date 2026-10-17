#!/usr/bin/env python3
"""Copy only the complete source check's exact compiled runtime snapshot."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil


def require(condition, message):
    if not condition:
        raise ValueError(message)


def source_inventory(root):
    result = {}
    def visit(directory):
        for file in directory.iterdir():
            if directory == root and file.name in {'node_modules', 'dist', 'data', '.git', 'coverage'}:
                continue
            if file.is_symlink():
                continue  # Matches the source check's regular-input policy.
            if file.is_dir():
                visit(file)
            elif file.is_file():
                name = file.relative_to(root).as_posix()
                if name != 'tests/standalone-evidence.json':
                    result[name] = digest(file)
    visit(root)
    return result


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def checked_path(root, name):
    require(isinstance(name, str) and name and '\\' not in name, 'Hash keys must use portable slash paths')
    require(not name.startswith('/') and all(part not in {'', '.', '..'} for part in name.split('/')), 'Unsafe evidence path')
    path = root.joinpath(*name.split('/'))
    require(path.is_file() and not path.is_symlink(), f'Missing or non-regular input: {name}')
    require(root in path.resolve().parents, f'Input escapes source: {name}')
    return path


def prepare(source, output):
    src, out = Path(source).resolve(), Path(output).resolve()
    require(not out.exists(), 'Output must be fresh')
    require(src != out and src not in out.parents and out not in src.parents, 'Source and output directories must not overlap')
    evidence = json.loads((src / 'tests/standalone-evidence.json').read_text())
    package = json.loads((src / 'package.json').read_text())
    require(re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', package['version']), 'A concrete release version is required')
    require(all(evidence.get('checks', {}).get(key) for key in ['test', 'test:ui', 'test:server', 'typecheck', 'build']), 'Run the complete source check first')
    require(evidence.get('sha256'), 'A verified source snapshot is required')
    require(source_inventory(src) == evidence['sha256'], 'Source inventory differs from the complete checked snapshot')
    snapshot = hashlib.sha256(json.dumps(evidence['sha256'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    for name, expected in evidence['sha256'].items():
        require(digest(checked_path(src, name)) == expected, f'Source differs from checked snapshot: {name}')
    artifacts = {}
    for file in (src / 'dist').rglob('*'):
        require(not file.is_symlink(), f'Build artifact symlinks are not allowed: {file}')
        if file.is_file():
            artifacts[file.relative_to(src).as_posix()] = digest(file)
    require(artifacts and artifacts == evidence.get('artifact_sha256'), 'Build outputs differ from the verified source check')
    require(all((src / name).is_file() for name in ['dist/server/main.mjs', 'dist/server/users.mjs', 'dist/client/index.html']), 'Build the source first')
    for directory in ['dist', 'drizzle']:
        for file in (src / directory).rglob('*'):
            require(not file.is_symlink() and (file.is_file() or file.is_dir()), f'Non-regular runtime input: {file}')
            require(not {'data', '.git'}.intersection(file.relative_to(src).parts), 'Do not bundle user data')
    try:
        out.mkdir(parents=True)
        shutil.copytree(src / 'dist', out / 'dist')
        shutil.copytree(src / 'drizzle', out / 'drizzle')
        # Shared by desktop backend and standalone-server packaging. Preserve
        # the source-acquisition notice and its relative MPL license link.
        for name in ['package.json', 'package-lock.json', 'README.md', 'AUTH.md', 'VERIFICATION.md',
                     'docs/THIRD-PARTY-NOTICES.md', 'docs/licenses/ical.js-MPL-2.0.txt']:
            target = out / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(checked_path(src, name), target)
        files = {file.relative_to(out).as_posix(): digest(file) for file in out.rglob('*') if file.is_file()}
        (out / 'RUNTIME-MANIFEST.json').write_text(json.dumps({'product': 'qingdan-standalone', 'version': package['version'], 'source_snapshot_sha256': snapshot, 'checks': evidence['checks'], 'files_sha256': files}, indent=2) + '\n')
    except BaseException:
        shutil.rmtree(out, ignore_errors=True)
        raise
    return out


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('output')
    args = parser.parse_args()
    print(prepare(args.source, args.output))
