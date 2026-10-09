"""Pinned server-release contract; no network or runtime substitution is allowed."""
import hashlib
import json
import re
from pathlib import Path, PurePosixPath

NODE_VERSION = '24.19.0'
NODE_URL = f'https://nodejs.org/dist/v{NODE_VERSION}/'
ARCHIVE_SHA256 = {
    'linux-x64': '14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647',
    'darwin-arm64': '3f1cf157479c1480352083105e13faf9d008ede98e7e157746b6df940d197b94',
}
# Byte sizes measured from the complete archives matching the fixed official SHA256 values.
ARCHIVE_BYTES = {'linux-x64': 31633904, 'darwin-arm64': 27162556}
BINARY_SHA256 = {
    'linux-x64': 'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12',
    'darwin-arm64': '27db838bb204ef7c21df2931f5656e4c8fb32e6e947f363a402b49714d32b5b1',
}
LICENSE_SHA256 = '148eacf7863ef4329224a29398623077200a27194aa075569faf4a0a85566ca5'
CHECKS = ('test', 'test:ui', 'test:server', 'typecheck', 'build')
ENTRYPOINTS = ('start.sh', 'start.command', 'stop.sh', 'stop.command',
               'start-accounts.sh', 'start-accounts.command', 'init-admin.sh', 'init-admin.command')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    hasher = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(chunk)
    return hasher.hexdigest()


def read_json(path):
    def unique(pairs):
        result = {}
        for name, value in pairs:
            require(name not in result, f'Duplicate JSON key: {name}')
            result[name] = value
        return result
    return json.loads(Path(path).read_text(encoding='utf-8'), object_pairs_hook=unique)


def safe_name(name):
    require(isinstance(name, str) and bool(name) and '\\' not in name and '\x00' not in name,
            f'Invalid manifest path: {name!r}')
    path = PurePosixPath(name)
    require(not path.is_absolute() and name == path.as_posix() and
            all(part not in ('', '.', '..') for part in path.parts), f'Unsafe manifest path: {name}')
    return name


def validate_hash(value, label):
    require(isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value), f'Invalid SHA256: {label}')


def files(root, allow_dependency_links=False):
    """Inventory regular files; npm .bin links may only target this dependency tree."""
    result = {}
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root).as_posix()
        safe_name(relative)
        require(not {'data', '.git'}.intersection(path.relative_to(root).parts),
                f'Do not bundle user data or git metadata: {relative}')
        if path.is_symlink():
            resolved = path.resolve()
            require(allow_dependency_links and relative.startswith('node_modules/.bin/') and
                    resolved.is_relative_to(root / 'node_modules') and resolved.is_file(),
                    f'Unsafe symlink in release payload: {relative}')
        if path.is_file():
            result[relative] = digest(path)
        else:
            require(path.is_dir() and not path.is_symlink(), f'Unsupported payload entry: {relative}')
    return result


def verify_file_map(root, inventory, exclude=(), allow_dependency_links=False):
    require(isinstance(inventory, dict) and bool(inventory), 'A nonempty file hash inventory is required')
    for name, expected in inventory.items():
        safe_name(name)
        validate_hash(expected, name)
        path = root / name
        require(path.is_file(), f'Missing payload file: {name}')
        require(digest(path) == expected, f'Payload SHA256 mismatch: {name}')
    actual = files(root, allow_dependency_links)
    actual = {name: value for name, value in actual.items()
              if name not in exclude and not any(name.startswith(prefix) for prefix in exclude if prefix.endswith('/'))}
    require(actual == inventory, 'Payload inventory differs from manifest (missing or unlisted files)')


def validate_application(app):
    manifest = read_json(app / 'RUNTIME-MANIFEST.json')
    package = read_json(app / 'package.json')
    require(manifest.get('product') == 'qingdan-standalone', 'Unexpected application product')
    require(isinstance(manifest.get('version'), str) and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', manifest['version']),
            'A concrete release version is required')
    require(manifest['version'] == package.get('version'), 'Runtime version mismatch')
    validate_hash(manifest.get('source_snapshot_sha256'), 'application source snapshot')
    require(all(manifest.get('checks', {}).get(key) for key in CHECKS), 'Complete source-check evidence is required')
    verify_file_map(app, manifest.get('files_sha256'), exclude=('RUNTIME-MANIFEST.json', 'node_modules/'),
                    allow_dependency_links=True)
    for name in ('dist/server/main.mjs', 'dist/server/users.mjs', 'dist/server/calendar-worker.mjs', 'dist/client/index.html', 'package-lock.json'):
        require(name in manifest['files_sha256'], f'Missing required verified application file: {name}')
    require(any(re.fullmatch(r'drizzle/\d{4}_[A-Za-z0-9_-]+\.sql', name) for name in manifest['files_sha256']),
            'Verified database migrations are required')
    lock = read_json(app / 'package-lock.json')
    require(lock.get('lockfileVersion') in (2, 3), 'A supported locked dependency tree is required')
    require(lock.get('version') == package['version'], 'Package-lock version mismatch')
    locked = lock.get('packages', {})
    require(locked.get('', {}).get('dependencies', {}) == package.get('dependencies', {}),
            'Production dependency declarations differ from package-lock')
    require(bool(package.get('dependencies')), 'Install the locked production dependencies first')
    for name in package['dependencies']:
        safe_name('node_modules/' + name + '/package.json')
        installed = read_json(app / 'node_modules' / name / 'package.json')
        expected = locked.get('node_modules/' + name, {})
        require(installed.get('name') == name and installed.get('version') == expected.get('version') and expected.get('version'),
                f'Production dependency is missing or differs from lock: {name}')
    # npm ci --omit=dev must not silently become a full development installation.
    for relative, entry in locked.items():
        if relative and entry.get('dev') is True:
            require(not (app / safe_name(relative) / 'package.json').exists(), f'Development dependency bundled: {relative}')
    validate_dependencies(app, manifest, locked)
    return manifest


def validate_dependencies(app, manifest, locked):
    require('dependency-manifest.json' in manifest['files_sha256'], 'A checked runtime dependency manifest is required')
    dependency = read_json(app / 'dependency-manifest.json')
    require(dependency.get('source_snapshot_sha256') == manifest['source_snapshot_sha256'], 'Dependency source snapshot mismatch')
    validate_hash(dependency.get('application_lock_sha256'), 'application package-lock provenance')
    require(dependency.get('external_imports') == manifest.get('external_imports') and isinstance(dependency.get('external_imports'), list),
            'Compiled external-import evidence differs from runtime manifest')
    records = dependency.get('packages')
    require(isinstance(records, list) and all(isinstance(record, dict) for record in records), 'Missing runtime dependency package inventory')
    expected_locations = set(locked) - {''}
    locations = [record.get('location') for record in records]
    require(len(locations) == len(set(locations)) and set(locations) == expected_locations, 'Dependency closure differs from runtime lock')
    declared_files = {}
    for record in records:
        location = safe_name(record['location'])
        require(location.startswith('node_modules/'), f'Unsafe dependency location: {location}')
        lock = locked[location]
        for field in ('version', 'resolved', 'integrity', 'license'):
            require(record.get(field) == lock.get(field), f'Dependency {field} differs from lock: {location}')
        require(isinstance(record.get('resolved'), str) and record['resolved'].startswith('https://registry.npmjs.org/') and
                isinstance(record.get('integrity'), str) and re.fullmatch(r'sha512-[A-Za-z0-9+/]+={0,2}', record['integrity']),
                f'Missing pinned npm origin/integrity: {location}')
        installed = read_json(app / location / 'package.json')
        require(installed.get('name') == record.get('name') and installed.get('version') == record['version'],
                f'Installed transitive dependency differs from lock: {location}')
        verify_file_map(app / location, record.get('files_sha256'), exclude=('node_modules/',))
        for name, expected in record['files_sha256'].items():
            full_name = location + '/' + name
            require(full_name not in declared_files or declared_files[full_name] == expected, f'Conflicting dependency file hash: {full_name}')
            declared_files[full_name] = expected
    actual_files = files(app / 'node_modules')
    actual_files.pop('.package-lock.json', None)
    require({'node_modules/' + name: value for name, value in actual_files.items()} == declared_files,
            'Installed dependency file tree differs from checked closure')


def read_checksums(path):
    checks = {}
    for line in Path(path).read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        parts = line.split()
        require(len(parts) == 2, 'Malformed official SHASUMS256.txt entry')
        checksum, name = parts
        validate_hash(checksum, name)
        require(name not in checks, f'Duplicate official checksum entry: {name}')
        checks[name] = checksum
    for arch, expected in ARCHIVE_SHA256.items():
        name = f'node-v{NODE_VERSION}-{arch}.tar.xz'
        require(checks.get(name) == expected, f'Pinned official archive checksum mismatch: {name}')
    return checks


def validate_runtime(directory):
    read_checksums(directory / 'SHASUMS256.txt')
    records = read_json(directory / 'NODE-RUNTIMES.json')
    require(isinstance(records, list) and len(records) == len(ARCHIVE_SHA256), 'Exactly two official Node runtime records are required')
    require({record.get('arch') for record in records if isinstance(record, dict)} == set(ARCHIVE_SHA256),
            'Duplicate, missing, or unsupported Node runtime architecture')
    for record in records:
        arch = record['arch']
        name = f'node-v{NODE_VERSION}-{arch}.tar.xz'
        require(record.get('filename') == name and record.get('url') == NODE_URL + name and
                record.get('sha256') == ARCHIVE_SHA256[arch], f'Official archive provenance mismatch: {arch}')
        require(type(record.get('bytes')) is int and record['bytes'] == ARCHIVE_BYTES[arch], f'Pinned archive byte size mismatch: {arch}')
        node = directory / arch / 'node'
        license_file = directory / arch / 'LICENSE'
        require(not node.is_symlink() and node.is_file() and not license_file.is_symlink() and license_file.is_file(),
                f'Node binary and license must be regular files: {arch}')
        require(digest(node) == BINARY_SHA256[arch] == record.get('node_sha256'), f'Pinned Node binary mismatch: {arch}')
        require(type(record.get('node_bytes')) is int and node.stat().st_size == record['node_bytes'], f'Node binary byte size mismatch: {arch}')
        require(digest(license_file) == LICENSE_SHA256, f'Pinned Node license mismatch: {arch}')
        require(node.stat().st_mode & 0o111, f'Node executable permission missing: {arch}')
    return records
