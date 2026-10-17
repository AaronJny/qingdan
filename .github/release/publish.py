#!/usr/bin/env python3
"""Publish exact verified assets; keep incomplete Android candidates as drafts."""
import argparse
import hashlib
import json
import os
import re
import subprocess
import zipfile
from pathlib import Path


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
        f'Qingdan-{version}-mac-arm64.dmg', f'Qingdan-{version}-mac-arm64.zip',
        'verified-mac-arm64.json', 'verified-mac-arm64-archives.json',
        'backend-verification-macos.json', 'MAC-START-HERE.txt', 'SHA256SUMS-macos.txt',
        f'Qingdan-{version}-win-x64.zip', 'verified-win-x64.json',
        'verified-win-x64-archives.json', 'backend-verification-windows.json',
        'WINDOWS-START-HERE.txt', 'SHA256SUMS-windows.txt',
        f'Qingdan-{version}-linux-x64.AppImage', 'verified-linux-x64.json',
        'verified-linux-appimage-x64.json', 'backend-verification-linux.json',
        'LINUX-START-HERE.txt', 'SHA256SUMS-linux.txt',
        f'qingdan-server-v{version}.zip', f'qingdan-server-v{version}.sha256',
        f'qingdan-server-v{version}.verification.json',
    }
    if android_ready:
        names.update({f'Qingdan-{android_version}-android.apk',
                      f'Qingdan-{android_version}-android.apk.verification.json',
                      'SHA256SUMS-android.txt'})
    return names


def mac_aliases(version):
    return {name: f'Qingdan-{version}-mac-arm64.{extension}'
            for extension in ('dmg', 'zip')
            for name in (f'青单-{version}-mac-arm64.{extension}',
                         f'-{version}-mac-arm64.{extension}')}


def file_record(path):
    return {'name': path.name, 'bytes': path.stat().st_size, 'sha256': digest(path)}


def normalize_macos(root, version):
    """Rename release-facing files/references only; never modify native app bytes."""
    aliases = mac_aliases(version)
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
    for name in ('verified-mac-arm64-archives.json', 'SHA256SUMS-macos.txt', 'MAC-START-HERE.txt'):
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
    expected = {
        'macos': f'Qingdan-{version}-mac-arm64.dmg',
        'windows': f'Qingdan-{version}-win-x64.zip',
        'server': f'qingdan-server-v{version}.zip',
        'linux': f'Qingdan-{version}-linux-x64.AppImage',
    }
    if android_ready:
        expected['android'] = f'Qingdan-{android_version}-android.apk'
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
    for platform, arch in (('mac','arm64'), ('win','x64'), ('linux','x64')):
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



def verify_macos_references(root, version):
    report = json.loads((root / 'verified-mac-arm64-archives.json').read_text())
    expected = {f'Qingdan-{version}-mac-arm64.{ext}' for ext in ('dmg', 'zip')}
    records = report.get('artifacts', [])
    require(len(records) == 2 and {a.get('filename') for a in records} == expected,
            'Mac archive report names differ from release candidates')
    for item in records:
        path = root / item['filename']
        require(item.get('bytes') == path.stat().st_size and item.get('sha256') == digest(path),
                'Mac archive report differs from candidate bytes')
    checksums = (root / 'SHA256SUMS-macos.txt').read_text().splitlines()
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
            'requiredPlatforms': ['macos', 'windows', 'server', 'linux', 'android'], 'deliverables': expected,
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
            require(canonical in {'verified-mac-arm64-archives.json', 'SHA256SUMS-macos.txt',
                                   'MAC-START-HERE.txt', 'RELEASE-MANIFEST.json'},
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
    old_expected = {'macos': f'青单-{version}-mac-arm64.dmg', 'windows': f'Qingdan-{version}-win-x64.zip',
                    'server': f'qingdan-server-v{version}.zip', 'linux': f'Qingdan-{version}-linux-x64.AppImage'}
    if complete:
        old_expected['android'] = f'Qingdan-{android_version}-android.apk'
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
    require(len(files) == (26 if complete else 23), 'Unexpected release candidate count')
    status = '五类成品均已生成并通过对应构建与包装检查。' if complete else '草稿：macOS、Windows、Linux 客户端与服务端成品已生成。Android 可安装 APK 尚未完成，当前不会发布 unsigned APK。请先完成 Android 发布签名配置，然后重跑发布工作流。'
    notes = '\n'.join([f'# 青单 {tag}', '', status, '',
                       '- macOS：Apple Silicon arm64 DMG；没有 Developer ID 签名或 Apple 公证，系统可能拦截。不要关闭 Gatekeeper 或移除隔离属性。',
                       '- Windows：x64 ZIP，解压后运行 Qingdan.exe，无需单独安装 Node。程序未签名。',
                       '- Linux：x64 AppImage，共用 Electron 前端/内置后端；需要系统正常支持 Chromium sandbox。',
                       '- 服务端：ZIP 包含 Linux x64/macOS arm64 官方 Node、锁定依赖、迁移和一键启动/停止/初始化管理员脚本；独立解压 Linux HTTP 验收已通过。',
                       f'- Android：独立客户端 {android_version}，内置业务基准 1.0.1。' + ('使用仓库已配置发布身份签名的 release APK；覆盖升级需要签名一致，升级前请导出完整备份。' if complete else '等待可用发布签名；APK 尚缺。'),
                       '', f'使用说明、功能介绍与部署步骤见 [项目文档](https://github.com/{repository}/blob/{commit}/README.md)。项目源码采用 AGPL-3.0-only，第三方组件保留各自许可与声明。',
                       '', '各平台检查报告与 SHA256 随成品附带。归档/后端验收不等于桌面 GUI 或 Android 真机验收。',
                       '', f'构建来源：{commit}', f'构建工作流：{build_url}',
                       f'发布来源：{publishing_commit}', f'发布工作流：{publish_url}', ''])
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
