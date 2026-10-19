#!/usr/bin/env python3
"""Publish exact verified assets; keep incomplete Android candidates as drafts."""
import argparse
import hashlib
import json
import os
import re
import subprocess
import unicodedata
import zipfile
from pathlib import Path


MAC_ARCHES = ('arm64', 'x64')
PLATFORMS = ['macos-arm64', 'macos-x64', 'windows', 'server', 'linux', 'android']
FUSES = {'RunAsNode': False, 'EnableCookieEncryption': True,
         'EnableNodeOptionsEnvironmentVariable': False, 'EnableNodeCliInspectArguments': False,
         'EnableEmbeddedAsarIntegrityValidation': True, 'OnlyLoadAppFromAsar': True,
         'GrantFileProtocolExtraPrivileges': False}
ELECTRON_VERSION = json.loads((Path(__file__).resolve().parents[2] / 'desktop/package.json').read_text())['devDependencies']['electron']
LOCAL_SESSION_ASSERTIONS = {
    'production sandboxed/context-isolated preload hydrates before first page script; no Node in main world',
    'same-origin but unowned window is rejected by production IPC',
    'foreign-origin frame with a bridge cannot access the owned local store',
    'non-local preload exposes no native business storage',
    'real subframe has no bridge and is rejected by frame identity',
    'loss of owned backend revokes storage access',
    'all observed sessions are nonpersistent; legacy sentinel unchanged; no credential request headers',
    'production window.open handler creates an owned sandboxed memory-session popup with synchronous native hydration',
    'production popup policy denies a foreign origin and requests external confirmation without opening it',
    'production Blob rescue durably exports owned input after backend loss; unowned Blob downloads and all tested HTTP requests stay blocked',
}


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def gh(*args, optional=False):
    result = subprocess.run(['gh', *args], text=True, capture_output=True)
    if result.returncode:
        if optional and ('HTTP 404' in result.stderr or 'release not found' in result.stderr):
            return None
        raise RuntimeError(f'GitHub operation failed: {result.stderr.strip()}')
    return result.stdout


def candidate_names(version, android_version, android_ready):
    names = {
        'MAC-START-HERE.txt',
        f'Qingdan-{version}-win-x64.zip', 'verified-win-x64.json',
        'verified-win-x64-archives.json', 'backend-verification-windows.json',
        'WINDOWS-START-HERE.txt', 'SHA256SUMS-windows.txt',
        f'Qingdan-{version}-linux-x64.AppImage', 'verified-linux-x64.json',
        'verified-linux-appimage-x64.json', 'backend-verification-linux.json',
        'LINUX-START-HERE.txt', 'SHA256SUMS-linux.txt',
        f'qingdan-server-v{version}.zip', f'qingdan-server-v{version}.sha256',
        f'qingdan-server-v{version}.verification.json',
    }
    for arch in MAC_ARCHES:
        names.update({f'Qingdan-{version}-mac-{arch}.dmg', f'Qingdan-{version}-mac-{arch}.zip',
                      f'verified-mac-{arch}.json', f'verified-mac-{arch}-archives.json',
                      f'backend-verification-macos-{arch}.json', f'SHA256SUMS-macos-{arch}.txt'})
    if android_ready:
        names.update({f'Qingdan-{android_version}-android.apk',
                      f'Qingdan-{android_version}-android.apk.verification.json',
                      'SHA256SUMS-android.txt'})
    return names


def mac_aliases(version):
    return {name: f'Qingdan-{version}-mac-{arch}.{extension}'
            for arch in MAC_ARCHES
            for extension in ('dmg', 'zip')
            for name in (f'青单-{version}-mac-{arch}.{extension}',
                         f'-{version}-mac-{arch}.{extension}')}


def file_record(path):
    return {'name': path.name, 'bytes': path.stat().st_size, 'sha256': digest(path)}


def normalize_macos(root, version):
    """Rename release-facing files/references only; never modify native app bytes."""
    aliases = mac_aliases(version)
    canonical = [aliases.get(path.name, path.name) for path in root.iterdir()]
    require(len(canonical) == len(set(canonical)), 'Duplicate local Mac candidate after normalization')
    for old, new in aliases.items():
        path = root / old
        if path.exists():
            require(not path.is_symlink() and path.is_file(), 'Release assets must be flat regular files')
            require(not (root / new).exists(), f'Duplicate local Mac candidate: {old} and {new}')
            path.rename(root / new)
    def replace(value):
        if isinstance(value, str):
            if value in aliases:
                return aliases[value]
            # The GitHub-stripped alias is a suffix of the canonical name.
            # Only full Chinese filenames may be replaced inside longer text.
            for old, new in aliases.items():
                if old.startswith('青单-'):
                    value = value.replace(old, new)
        elif isinstance(value, list):
            value = [replace(item) for item in value]
        elif isinstance(value, dict):
            value = {key: replace(item) for key, item in value.items()}
        return value
    for name in {'MAC-START-HERE.txt', *[name for arch in MAC_ARCHES for name in
                (f'verified-mac-{arch}-archives.json', f'SHA256SUMS-macos-{arch}.txt')]}:
        path = root / name
        if not path.exists():
            continue
        text = path.read_text(encoding='utf-8')
        if path.suffix == '.json':
            value = json.loads(text)
            updated = replace(value)
            if updated != value:
                path.write_bytes(encoded_json(updated))
        else:
            updated = replace(text)
            if updated != text:
                path.write_text(updated, encoding='utf-8')


def collect(root, version, android_version, android_ready):
    files = sorted(root.iterdir())
    require(files and all(p.is_file() and not p.is_symlink() for p in files), 'Release assets must be flat regular files')
    require(all(not re.search(r'(?i)(keystore|\.p12$|\.jks$|password|\.keystore$)', p.name) for p in files), 'Private signing material in asset directory')
    expected = expected_deliverables(version, android_version, android_ready)
    require(not any(p.suffix == '.apk' for p in files) or android_ready, 'APK may only publish after signed Android verification succeeds')
    for platform, name in expected.items():
        path = root / name
        require(path.is_file() and path.stat().st_size > 1024, f'Missing {platform} deliverable {name}')
        if path.suffix in ('.zip', '.apk'):
            with zipfile.ZipFile(path) as archive:
                require(archive.testzip() is None, f'{name} ZIP integrity failed')
        elif path.suffix == '.dmg':
            with path.open('rb') as stream:
                stream.seek(-512, 2)
                require(stream.read(4) == b'koly', 'DMG lacks native UDIF trailer')
        elif path.suffix == '.AppImage':
            with path.open('rb') as stream:
                header = stream.read(12)
            require(header[:4] == b'\x7fELF' and header[8:11] == b'AI\x02', 'Linux output is not type-2 AppImage')
    server_report = json.loads((root / f'qingdan-server-v{version}.verification.json').read_text())
    require(server_report.get('version') == version and server_report.get('status') == 'passed' and server_report.get('smoke', {}).get('status') == 'passed', 'Server clean-extracted runtime smoke not passed')
    for platform, arch in (('mac','arm64'), ('mac','x64'), ('win','x64'), ('linux','x64')):
        report = json.loads((root / f'verified-{platform}-{arch}.json').read_text())
        require(report.get('version') == version and report.get('backendVersion') == version and report.get('fusesVerified'), f'{platform} packaged snapshot/fuse evidence missing')
    if android_ready:
        apk = root / expected['android']
        report = json.loads((root / (apk.name + '.verification.json')).read_text())
        require(report.get('installable_candidate') and report.get('signature', {}).get('verified') and report.get('signature', {}).get('v2_verified') and report.get('manifest_identity_verified') and report.get('zip_16k_alignment_verified'), 'Android installable signature/identity/alignment evidence missing')
        require(report.get('apk') == apk.name and report.get('bytes') == apk.stat().st_size and report.get('sha256') == digest(apk), 'Android signed verification evidence is for different bytes')
        require(report.get('manifest', {}).get('application_id') == 'cn.qingdan.android' and report.get('manifest', {}).get('version_name') == android_version, 'Android package identity/version differs')
    require({p.name for p in files} == candidate_names(version, android_version, android_ready), 'Local release asset inventory differs from exact candidate set')
    verify_macos_references(root, version)
    return expected, files



def expected_deliverables(version, android_version, android_ready=True):
    expected = {f'macos-{arch}': f'Qingdan-{version}-mac-{arch}.dmg' for arch in MAC_ARCHES}
    expected.update({'windows': f'Qingdan-{version}-win-x64.zip',
                     'server': f'qingdan-server-v{version}.zip',
                     'linux': f'Qingdan-{version}-linux-x64.AppImage'})
    if android_ready:
        expected['android'] = f'Qingdan-{android_version}-android.apk'
    return expected


def valid_sha(value):
    return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value) is not None


def safe_relative_path(value):
    return (isinstance(value, str) and value and not value.startswith('/')
            and not re.search(r'[\\\x00-\x1f]', value)
            and all(part not in ('', '.', '..') for part in value.split('/')))


def verify_mac_architecture(evidence, arch):
    require(isinstance(evidence, dict) and evidence.get('targetArch') == arch
            and evidence.get('allMachOMatchTarget') is True, 'Mac Mach-O target architecture differs')
    entries, seen = evidence.get('machOFiles'), set()
    require(isinstance(entries, list) and entries, 'Mac Mach-O architecture inventory missing')
    for entry in entries:
        require(isinstance(entry, dict) and safe_relative_path(entry.get('path'))
                and entry.get('format') in ('mach-o64', 'fat32', 'fat64')
                and entry.get('architectures') == [arch], 'Mac Mach-O file architecture differs')
        key = unicodedata.normalize('NFC', entry['path']).casefold()
        require(key not in seen, 'Duplicate Mac Mach-O path')
        seen.add(key)
    modules = evidence.get('nativeNodeModules')
    require(isinstance(modules, list) and all(safe_relative_path(name) and name.lower().endswith('.node')
            for name in modules) and len(set(modules)) == len(modules), 'Invalid Mac native Node inventory')
    require(set(modules).issubset({entry['path'] for entry in entries}),
            'Mac native Node module missing independent architecture evidence')


def verify_mac_host(host, arch):
    require(isinstance(host, dict) and host.get('platform') == 'darwin' and host.get('arch') == arch
            and host.get('machine') == {'arm64': 'arm64', 'x64': 'x86_64'}[arch]
            and host.get('runnerArch') == {'arm64': 'ARM64', 'x64': 'X64'}[arch]
            and host.get('translated') is False, 'Mac verification did not run on matching native host')


def verify_mac_package(report, version, arch):
    require(isinstance(report, dict) and report.get('platform') == 'mac' and report.get('arch') == arch
            and report.get('version') == version and report.get('backendVersion') == version,
            'Mac packaged report target or version differs')
    require(report.get('fusesVerified') == FUSES
            and all(type(report['fusesVerified'].get(key)) is bool for key in FUSES),
            'Mac packaged fuse evidence differs')
    require(all(valid_sha(report.get(key)) for key in
                ('executableSha256', 'asarSha256', 'backendSourceSnapshotSha256')),
            'Mac packaged payload hash evidence missing')
    verify_mac_architecture(report.get('macArchitecture'), arch)
    verify_mac_host(report.get('nativeHost'), arch)
    binding = report.get('finalRecoveryBinding')
    require(isinstance(binding, dict)
            and binding.get('entry') == f'node_modules/classic-level/prebuilds/darwin-{arch}/classic-level.node'
            and valid_sha(binding.get('sha256')) and type(binding.get('bytes')) is int and binding['bytes'] > 0
            and binding.get('unpacked') is True and binding.get('finalDiskBytes') is True,
            'Mac final unpacked recovery binding hash evidence missing')


def verify_local_session_smoke(report, arch):
    """Synthetic stock-Electron evidence, never packaged GUI or Keychain proof."""
    require(isinstance(report, dict) and report.get('schema') == 'qingdan-real-local-session-smoke-v1'
            and report.get('passed') is True and report.get('platform') == 'darwin'
            and report.get('arch') == arch and 'error' not in report,
            'Mac local session smoke did not pass on the native target')
    require(all(report.get(key) is False for key in
                ('packagedAppTested', 'keychainAccessInstrumented', 'realUserProfileAccessed')),
            'Mac local session smoke scope or safety evidence differs')
    require(all(report.get(key) is True for key in ('actualProcessRestart', 'sameOriginAcrossRestart')),
            'Mac local session smoke restart evidence missing')
    runtime = report.get('runtime')
    require(isinstance(runtime, dict) and all(runtime.get(key) is True for key in
                ('testCookieEncryption', 'onlyCookieEncryptionFuseChanged',
                 'sourceFuseWireUnchanged', 'macTestCopyAdHocReset'))
            and type(runtime.get('sourceCookieEncryption')) is bool,
            'Mac local session smoke runtime fuse evidence missing')
    phases = report.get('phases')
    require(isinstance(phases, list) and len(phases) == 2
            and all(isinstance(phase, dict) for phase in phases)
            and [phase.get('phase') for phase in phases] == ['write', 'read'],
            'Mac local session smoke requires write and read processes')
    for phase in phases:
        require(phase.get('passed') is True and phase.get('arch') == arch
                and phase.get('electron') == ELECTRON_VERSION and phase.get('stage') == 'complete'
                and phase.get('keychainAccessInstrumented') is False and 'error' not in phase
                and type(phase.get('pid')) is int and phase['pid'] > 0,
                'Mac local session smoke phase runtime or result differs')
        sessions = phase.get('sessions')
        require(isinstance(sessions, list) and sessions and all(isinstance(item, dict)
                and item.get('persistent') is False and item.get('storagePathNull') is True
                for item in sessions), 'Mac local session smoke activated a persistent session')
        assertions = phase.get('assertions')
        required = LOCAL_SESSION_ASSERTIONS | ({
            'synchronous bridge write is durable before returning to the renderer',
            'renderer recreation hydrates the production durable store',
        } if phase['phase'] == 'write' else {
            'same-origin process restart retains native draft while Chromium localStorage is empty',
        })
        require(isinstance(assertions, list) and all(isinstance(item, str) for item in assertions)
                and required.issubset(assertions), 'Mac local session smoke safety assertions missing')
    first, second = phases
    require(first['pid'] != second['pid'] and first.get('origin') == second.get('origin')
            and isinstance(first.get('origin'), str)
            and re.fullmatch(r'http://127\.0\.0\.1:[1-9][0-9]{0,4}', first['origin']) is not None
            and 0 < int(first['origin'].rsplit(':', 1)[1]) < 65536
            and first.get('partition') == second.get('partition')
            and isinstance(first.get('partition'), str)
            and re.fullmatch(r'qingdan-desktop-memory-local-[0-9a-f]{20}', first['partition']) is not None,
            'Mac local session smoke did not restart the same memory-session origin')


def verify_packaged_recovery_smoke(report, package, arch):
    require(isinstance(report, dict) and report.get('schema') == 'qingdan-packaged-recovery-smoke-v1'
            and report.get('passed') is True and report.get('platform') == 'darwin'
            and report.get('arch') == arch and report.get('electron') == ELECTRON_VERSION
            and report.get('classicLevel') == '3.0.0' and 'error' not in report,
            'Mac packaged recovery binding runtime smoke did not pass')
    require(all(report.get(key) is True for key in
                ('stockElectronNodeMode', 'packagedAsarModuleLoaded', 'packagedUnpackedBindingLoaded',
                 'syntheticWriteReadReopenPassed', 'stockRuntimeFuseWireUnchanged', 'packagedPayloadUnchanged'))
            and all(report.get(key) is False for key in
                ('productAppLaunched', 'nativeGuiTested', 'keychainAccessInstrumented', 'realUserProfileAccessed')),
            'Mac packaged recovery smoke scope or runtime evidence differs')
    require(report.get('asarSha256') == package['asarSha256']
            and report.get('executableSha256') == package['executableSha256']
            and valid_sha(report.get('bindingSha256'))
            and report.get('bindingSha256') == package.get('finalRecoveryBinding', {}).get('sha256')
            and report.get('bindingEntry') == f'node_modules/classic-level/prebuilds/darwin-{arch}/classic-level.node',
            'Mac packaged recovery smoke does not match the packaged payload')
    require('Contents/Resources/app.asar.unpacked/' + report['bindingEntry']
            in package.get('macArchitecture', {}).get('nativeNodeModules', []),
            'Mac packaged recovery binding is missing independent architecture evidence')


def verify_macos_references(root, version):
    for arch in MAC_ARCHES:
        package = json.loads((root / f'verified-mac-{arch}.json').read_text())
        verify_mac_package(package, version, arch)
        verify_local_session_smoke(package.get('localSessionSmoke'), arch)
        verify_packaged_recovery_smoke(package.get('packagedRecoverySmoke'), package, arch)
        backend = json.loads((root / f'backend-verification-macos-{arch}.json').read_text())
        require(backend.get('version') == version and backend.get('runtimePlatform') == 'darwin'
                and backend.get('runtimeArch') == arch
                and backend.get('sourceSnapshotSha256') == package['backendSourceSnapshotSha256'],
                'Mac backend target, version or source snapshot differs')
        require(all(backend.get('smoke', {}).get(key) is True for key in
                    ('loopbackStartup', 'currentVersionHandshake', 'frontend', 'offlineShellAssets',
                     'migrations', 'calendarWorker', 'syntheticTask', 'gracefulRestartPersistence')),
                'Mac native backend runtime smoke not passed')
        modules = backend.get('nativeNodeModules')
        require(isinstance(modules, list) and all(isinstance(item, dict)
                and safe_relative_path(item.get('path')) and item['path'].lower().endswith('.node')
                and item.get('format') in ('mach-o64', 'fat32', 'fat64')
                and item.get('architectures') == [arch] for item in modules)
                and len({item['path'] for item in modules}) == len(modules),
                'Mac backend native Node architecture differs')
        report = json.loads((root / f'verified-mac-{arch}-archives.json').read_text())
        require(report.get('platform') == 'mac' and report.get('arch') == arch
                and report.get('version') == version and report.get('nativeArchiveToolsUsed') is True
                and report.get('originalPayloadUnchanged') is True, 'Mac archive target or native verification differs')
        verify_mac_host(report.get('nativeHost'), arch)
        baseline = report.get('unpackedPayloadMetadata', {})
        verify_mac_architecture(baseline.get('macArchitecture'), arch)
        expected = {f'Qingdan-{version}-mac-{arch}.{ext}' for ext in ('dmg', 'zip')}
        records = report.get('artifacts', [])
        require(isinstance(records, list) and len(records) == 2
                and all(isinstance(item, dict) for item in records)
                and {item.get('filename') for item in records} == expected,
                'Mac archive report names differ from release candidates')
        for item in records:
            path = root / item['filename']
            require(type(item.get('bytes')) is int and item['bytes'] == path.stat().st_size
                    and valid_sha(item.get('sha256')) and item['sha256'] == digest(path),
                    'Mac archive report differs from candidate bytes')
            require(item.get('platform') == 'mac' and item.get('arch') == arch
                    and item.get('format') == path.suffix[1:],
                    'Mac archive artifact target or format differs')
            require(path.stat().st_size > 1024, 'Mac archive candidate is incomplete')
            if path.suffix == '.zip':
                with zipfile.ZipFile(path) as archive:
                    require(archive.testzip() is None, 'Mac ZIP integrity failed')
            proof = 'freshNativeExtractionVerified' if path.suffix == '.zip' else 'nativeReadOnlyMountVerified'
            require(item.get(proof) is True and (path.suffix != '.dmg' or item.get('applicationsLinkVerified') is True),
                    'Mac archive native extraction or mount not verified')
            matched = item.get('payloadMatched', {})
            require(all(matched.get(key) is True for key in
                        ('allFileBytesMatched', 'allPathsMatched', 'unixModesMatched'))
                    and valid_sha(matched.get('inventorySha256')), 'Mac archive payload equality not verified')
            metadata = item.get('metadata', {})
            verify_mac_architecture(metadata.get('macArchitecture'), arch)
            require(metadata == baseline, 'Mac archive metadata differs from verified unpacked payload')
            embedded = item.get('packagedVerification', {})
            verify_mac_package(embedded, version, arch)
            require(all(embedded.get(key) == package[key] for key in
                        ('executableSha256', 'asarSha256', 'backendSourceSnapshotSha256', 'macArchitecture', 'finalRecoveryBinding')),
                    'Mac archive packaged payload differs from per-architecture verification')
        checksums = (root / f'SHA256SUMS-macos-{arch}.txt').read_text().splitlines()
        actual = {}
        for line in checksums:
            match = re.fullmatch(r'([0-9a-f]{64}) [ *](.+)', line)
            require(match and match[2] not in actual, 'Invalid or duplicate Mac checksum entry')
            actual[match[2]] = match[1]
        require(set(actual) == expected, 'Mac checksum inventory differs')
        require(all(actual[name] == digest(root / name) for name in expected), 'Mac checksum differs')


LIMITATIONS = ['macOS has no Developer ID signature or Apple notarization.', 'Windows executable is unsigned.',
              'Desktop GUI acceptance and Android physical-device acceptance are not established by archive/backend checks.',
              'Android client uses independent application 1.0.1 business-code baseline.']


def manifest_value(version, commit, complete, expected, records):
    return {'schema': 'qingdan-release-assets-v1', 'version': version, 'sourceCommit': commit, 'complete': complete,
            'requiredPlatforms': list(PLATFORMS), 'deliverables': expected,
            'missingPlatforms': [] if complete else ['android'], 'assets': records, 'limitations': LIMITATIONS}


def encoded_json(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def byte_record(name, content):
    return {'name': name, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}


def remote_release(repository, tag, optional=False):
    text = gh('release', 'view', tag, '--repo', repository,
              '--json', 'apiUrl,isDraft,targetCommitish,tagName,url', optional=optional)
    if text is None:
        return None
    overview = json.loads(text)
    # REST returns numeric asset IDs and SHA256 digests, unlike some gh view versions.
    value = json.loads(gh('api', overview['apiUrl']))
    require(value.get('tag_name') == tag, 'GitHub returned a different release identity')
    require(isinstance(value.get('assets'), list), 'GitHub release assets missing')
    return value


def same_bytes(asset, record):
    return asset.get('size') == record['bytes'] and asset.get('digest') == 'sha256:' + record['sha256']


def draft_plan(release, files, legacy, version):
    """Validate every asset before any mutation; fail closed on ambiguous duplicates."""
    candidates = {p.name: file_record(p) for p in files}
    aliases = mac_aliases(version)
    existing, renames, replacements = {}, [], []
    for asset in release['assets']:
        name = asset['name']
        canonical = aliases.get(name, name)
        require(canonical in candidates, f'Unknown existing draft asset: {name}')
        require(canonical not in existing, f'Duplicate existing draft candidate: {canonical}; preserve assets and resolve explicitly')
        require(isinstance(asset.get('id'), int) and asset['id'] > 0, f'Invalid release asset ID: {name}')
        expected = candidates[canonical]
        previous = legacy.get(name) or legacy.get(canonical)
        require(same_bytes(asset, expected) or (previous and same_bytes(asset, previous)),
                f'Existing draft asset size/digest differs from verified candidate: {name}')
        existing[canonical] = asset
        if name != canonical:
            require(same_bytes(asset, expected), f'Legacy Mac payload digest differs: {name}')
            renames.append((asset['id'], canonical))
        elif not same_bytes(asset, expected):
            # Only transformed known text evidence/manifest may be replaced. Payloads never are.
            require(canonical in {'MAC-START-HERE.txt', 'RELEASE-MANIFEST.json',
                                   *[name for arch in MAC_ARCHES for name in
                                     (f'verified-mac-{arch}-archives.json', f'SHA256SUMS-macos-{arch}.txt')]},
                    f'Unexpected changed release asset: {name}')
            replacements.append(canonical)
    missing = sorted(set(candidates) - set(existing))
    return renames, replacements, missing


def verify_remote_inventory(release, files, commit):
    require(release.get('target_commitish') == commit, 'Release source differs from verified source commit')
    actual = release['assets']
    expected = {p.name: file_record(p) for p in files}
    require(len(actual) == len(expected) and {a['name'] for a in actual} == set(expected),
            'Release asset inventory differs from exact candidate set')
    for asset in actual:
        require(same_bytes(asset, expected[asset['name']]),
                f'Uploaded release asset size/digest differs: {asset["name"]}')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', required=True)
    parser.add_argument('--android-result', required=True)
    parser.add_argument('--source-commit', help='Verified original build commit (40 lowercase hexadecimal characters)')
    parser.add_argument('--source-run-id', help='Verified original build workflow run ID')
    args = parser.parse_args(argv)
    root = Path(args.assets)
    request = json.loads(Path('.github/release/request.json').read_text())
    version, android_version = request['version'], request['androidVersion']
    require(re.fullmatch(r'\d+\.\d+\.\d+', version), 'Invalid release version')
    repository = os.environ['GITHUB_REPOSITORY']
    publishing_commit = os.environ['GITHUB_SHA']
    commit = args.source_commit if args.source_commit is not None else publishing_commit
    publishing_run = os.environ['GITHUB_RUN_ID']
    source_run = args.source_run_id if args.source_run_id is not None else publishing_run
    require(re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository)
            and re.fullmatch(r'[0-9a-f]{40}', commit)
            and re.fullmatch(r'[0-9a-f]{40}', publishing_commit), 'Invalid workflow source')
    require(re.fullmatch(r'[1-9][0-9]*', source_run) and re.fullmatch(r'[1-9][0-9]*', publishing_run),
            'Invalid workflow run ID')
    require((args.source_commit is None) == (args.source_run_id is None),
            'Original source commit and run ID must be supplied together')
    tag = f'v{version}'
    complete = args.android_result == 'success'
    original = sorted(root.iterdir())
    require(original and all(p.is_file() and not p.is_symlink() for p in original),
            'Release assets must be flat regular files')
    require(all(not re.search(r'(?i)(keystore|\.p12$|\.jks$|password|\.keystore$)', p.name) for p in original),
            'Private signing material in asset directory')
    # The build artifacts do not contain the publisher-generated manifest. Keep exact
    # original evidence hashes so a previously interrupted draft can be reconciled safely.
    original_records = [file_record(p) for p in original if p.name != 'RELEASE-MANIFEST.json']
    legacy = {p['name']: p for p in original_records}
    old_expected = expected_deliverables(version, android_version, complete)
    for alias, canonical in mac_aliases(version).items():
        if alias in legacy:
            old_expected.update({target: alias for target, name in old_expected.items() if name == canonical})
    old_manifest = encoded_json(manifest_value(version, commit, complete, old_expected, original_records))
    legacy['RELEASE-MANIFEST.json'] = byte_record('RELEASE-MANIFEST.json', old_manifest)
    # Support an idempotent retry whose local directory already contains our manifest.
    manifest_path = root / 'RELEASE-MANIFEST.json'
    if manifest_path.exists():
        previous_manifest = json.loads(manifest_path.read_text())
        require(previous_manifest.get('sourceCommit') == commit, 'Existing local manifest source differs')
        manifest_path.unlink()
    normalize_macos(root, version)
    expected, files = collect(root, version, android_version, complete)
    manifest = manifest_value(version, commit, complete, expected, [file_record(p) for p in files])
    build_url = f'https://github.com/{repository}/actions/runs/{source_run}'
    publish_url = f'https://github.com/{repository}/actions/runs/{publishing_run}'
    manifest.update({'sourceRunId': source_run, 'sourceRunUrl': build_url,
                     'publishingCommit': publishing_commit, 'publishingRunId': publishing_run,
                     'publishingRunUrl': publish_url})
    manifest_path.write_bytes(encoded_json(manifest))
    files.append(manifest_path)
    require(len(files) == len(candidate_names(version, android_version, complete)) + 1
            and {path.name for path in files} == candidate_names(version, android_version, complete) | {'RELEASE-MANIFEST.json'},
            'Unexpected release candidate inventory')
    status = '支持 macOS、Windows、Linux、Android 和自托管网页端。 / Available for macOS, Windows, Linux, Android and self-hosted web.' if complete else '草稿：Android 签名安装包尚未就绪。 / Draft: the signed Android package is not ready.'
    download = f'https://github.com/{repository}/releases/download/{tag}'
    notes = '\n'.join([f'# 青单 / Qingdan {tag}', '', status, '',
                       '## 更新 / What’s new',
                       '- 日历任务支持拖动左边缘调整开始日期、拖动右边缘调整结束日期，可跨周行扩展或缩短。 / Drag a calendar task’s left edge to adjust its start date or its right edge to adjust its end date, including across week rows.',
                       '- 拖动任务中间仍会整体移动，保留任务跨度；调整范围时实时预览日期，并防止开始、结束日期倒置。 / Drag the task body to move the entire task while keeping its span. Date previews update as you resize, and endpoints cannot cross.',
                       '- 支持触屏拖动与键盘方向键调整；按 Esc 可取消当前调整。九种界面语言同步更新。 / Resize with touch or keyboard arrows, and press Esc to cancel a drag. Updated guidance is available in all nine interface languages.',
                       '', '## 下载 / Downloads',
                       f'- macOS Apple Silicon：[DMG]({download}/Qingdan-{version}-mac-arm64.dmg) · [ZIP]({download}/Qingdan-{version}-mac-arm64.zip)',
                       f'- macOS Intel：[DMG]({download}/Qingdan-{version}-mac-x64.dmg) · [ZIP]({download}/Qingdan-{version}-mac-x64.zip)',
                       '- Mac 安装包尚无 Developer ID 签名或 Apple 公证，系统可能阻止运行。遇到安全警告时，请核实下载来源并保留系统安全设置。 / Mac packages lack Developer ID signing and Apple notarization and may be blocked. If you see a security warning, verify the download source and keep system security protections enabled.',
                       f'- Windows x64：[ZIP]({download}/Qingdan-{version}-win-x64.zip)，完整解压后运行 Qingdan.exe。此版本尚无发布者签名。 / Extract the entire archive and run Qingdan.exe. This build has no publisher signature.',
                       f'- Linux x64：[AppImage]({download}/Qingdan-{version}-linux-x64.AppImage)',
                       f'- 服务端 / Server：[ZIP]({download}/qingdan-server-v{version}.zip)，支持 Linux x64 / macOS arm64，内置运行环境与启动脚本。 / Supports Linux x64 and macOS arm64, with bundled runtimes and start scripts.',
                       (f'- Android {android_version}：[APK]({download}/Qingdan-{android_version}-android.apk)。更新前请导出完整备份，覆盖升级须签名一致。 / Export a full backup before updating; upgrades require the same signing identity.'
                        if complete else f'- Android {android_version}：等待发布签名。 / Awaiting release signing.'),
                       '', f'[中文说明](https://github.com/{repository}/blob/{commit}/README.md) · [English guide](https://github.com/{repository}/blob/{commit}/README.en.md)', ''])
    notes_path = root.parent / 'release-notes.md'
    notes_path.write_text(notes)
    old = remote_release(repository, tag, optional=True)
    if old and not old['draft']:
        require(complete, 'Published release cannot be changed into an incomplete draft')
        verify_remote_inventory(old, files, commit)
        print(json.dumps({'url': old['html_url'], 'draft': False, 'alreadyPublished': True}))
        return
    if old:
        require(old.get('target_commitish') == commit, 'Existing draft belongs to a different verified source')
        renames, replacements, missing = draft_plan(old, files, legacy, version)
    tag_text = gh('api', f'repos/{repository}/git/ref/tags/{tag}', optional=True)
    if tag_text:
        tag_object = json.loads(tag_text)['object']
        seen = set()
        while tag_object['type'] == 'tag':
            require(tag_object['sha'] not in seen, 'Cyclic annotated tag')
            seen.add(tag_object['sha'])
            tag_object = json.loads(gh('api', tag_object['url']))['object']
        require(tag_object['sha'] == commit, 'Existing tag points at a different source; do not move released identities automatically')
    if old:
        for asset_id, name in renames:
            gh('api', '--method', 'PATCH', f'repos/{repository}/releases/assets/{asset_id}', '-f', f'name={name}')
        gh('release', 'edit', tag, '--repo', repository, '--draft', '--target', commit,
           '--title', f'青单 {tag}', '--notes-file', str(notes_path))
        if replacements or missing:
            gh('release', 'upload', tag, '--repo', repository, '--clobber',
               *[str(root / name) for name in replacements + missing])
    else:
        gh('release', 'create', tag, '--repo', repository, '--draft', '--target', commit,
           '--title', f'青单 {tag}', '--notes-file', str(notes_path), *[str(p) for p in files])
    current = remote_release(repository, tag)
    verify_remote_inventory(current, files, commit)
    require(current['draft'], 'Candidate release must remain draft until final verification')
    if complete:
        gh('release', 'edit', tag, '--repo', repository, '--draft=false', '--target', commit, '--latest')
    final = remote_release(repository, tag)
    verify_remote_inventory(final, files, commit)
    require(final['draft'] != complete, 'Release publication state differs from verified completeness')
    print(json.dumps({'url': final['html_url'], 'draft': final['draft'], 'deliverables': expected}, ensure_ascii=False))
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
        stream.write(f'## {"已发布" if complete else "草稿（Android 尚缺）"}\n\n{final["html_url"]}\n\n' + status + '\n')


if __name__ == '__main__':
    main()
