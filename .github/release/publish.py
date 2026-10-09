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


def collect(root, version, android_version, android_ready):
    files = sorted(root.iterdir())
    require(files and all(p.is_file() and not p.is_symlink() for p in files), 'Release assets must be flat regular files')
    require(all(not re.search(r'(?i)(keystore|\.p12$|\.jks$|password|\.keystore$)', p.name) for p in files), 'Private signing material in asset directory')
    expected = {
        'macos': f'青单-{version}-mac-arm64.dmg',
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
    return expected, files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', required=True)
    parser.add_argument('--android-result', required=True)
    args = parser.parse_args()
    root = Path(args.assets)
    request = json.loads(Path('.github/release/request.json').read_text())
    version, android_version = request['version'], request['androidVersion']
    require(re.fullmatch(r'\d+\.\d+\.\d+', version), 'Invalid release version')
    repository, commit = os.environ['GITHUB_REPOSITORY'], os.environ['GITHUB_SHA']
    require(re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository) and re.fullmatch(r'[0-9a-f]{40}', commit), 'Invalid workflow source')
    tag = f'v{version}'
    complete = args.android_result == 'success'
    expected, files = collect(root, version, android_version, complete)
    manifest = {'schema':'qingdan-release-assets-v1', 'version':version, 'sourceCommit':commit, 'complete':complete,
                'requiredPlatforms':['macos','windows','server','linux','android'], 'deliverables':expected,
                'missingPlatforms':[] if complete else ['android'],
                'assets':[{'name':p.name,'bytes':p.stat().st_size,'sha256':digest(p)} for p in files],
                'limitations':['macOS has no Developer ID signature or Apple notarization.', 'Windows executable is unsigned.',
                               'Desktop GUI acceptance and Android physical-device acceptance are not established by archive/backend checks.',
                               'Android client uses independent application 1.0.1 business-code baseline.']}
    manifest_path = root / 'RELEASE-MANIFEST.json'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    files.append(manifest_path)
    status = '五类成品均已生成并通过对应构建与包装检查。' if complete else '草稿：macOS、Windows、Linux 客户端与服务端成品已生成。Android 可安装 APK 尚未完成，当前不会发布 unsigned APK。请先完成 Android 发布签名配置，然后重跑发布工作流。'
    notes = '\n'.join([f'# 青单 {tag}', '', status, '',
                       '- macOS：Apple Silicon arm64 DMG；没有 Developer ID 签名或 Apple 公证，系统可能拦截。不要关闭 Gatekeeper 或移除隔离属性。',
                       '- Windows：x64 ZIP，解压后运行 Qingdan.exe，无需单独安装 Node。程序未签名。',
                       '- Linux：x64 AppImage，共用 Electron 前端/内置后端；需要系统正常支持 Chromium sandbox。',
                       '- 服务端：ZIP 包含 Linux x64/macOS arm64 官方 Node、锁定依赖、迁移和一键启动/停止/初始化管理员脚本；独立解压 Linux HTTP 验收已通过。',
                       f'- Android：独立客户端 {android_version}，内置业务基准 1.0.1。' + ('可安装自签名 release APK；新签名不能覆盖安装旧签名应用，请先备份。' if complete else '等待可用发布签名；APK 尚缺。'),
                       '', '各平台检查报告与 SHA256 随成品附带。归档/后端验收不等于桌面 GUI 或 Android 真机验收。',
                       '', f'构建来源：{commit}', f'工作流：https://github.com/{repository}/actions/runs/{os.environ["GITHUB_RUN_ID"]}', ''])
    notes_path = root.parent / 'release-notes.md'
    notes_path.write_text(notes)
    old_text = gh('release','view',tag,'--repo',repository,'--json','isDraft,targetCommitish,tagName,assets,url',optional=True)
    old = json.loads(old_text) if old_text else None
    if old and not old['isDraft']:
        require(old.get('targetCommitish') == commit, 'A published release already uses this version for a different source; bump the version')
        require(complete and {p.name for p in files}.issubset({a['name'] for a in old['assets']}), 'Published release is missing current required assets')
        print(json.dumps({'url':old['url'],'draft':False,'alreadyPublished':True}))
        return
    tag_text = gh('api',f'repos/{repository}/git/ref/tags/{tag}',optional=True)
    if tag_text:
        tag_object = json.loads(tag_text)['object']
        while tag_object['type'] == 'tag':
            tag_object = json.loads(gh('api',tag_object['url']))['object']
        require(tag_object['sha'] == commit, 'Existing tag points at a different source; do not move released identities automatically')
    if old:
        gh('release','edit',tag,'--repo',repository,'--draft','--target',commit,'--title',f'青单 {tag}','--notes-file',str(notes_path))
        gh('release','upload',tag,'--repo',repository,'--clobber',*[str(p) for p in files])
    else:
        gh('release','create',tag,'--repo',repository,'--draft','--target',commit,'--title',f'青单 {tag}','--notes-file',str(notes_path),*[str(p) for p in files])
    current = json.loads(gh('release','view',tag,'--repo',repository,'--json','isDraft,targetCommitish,assets,url'))
    actual = {a['name']:a for a in current['assets']}
    require({p.name for p in files} == set(actual), 'Release asset inventory differs from exact candidate set')
    for path in files:
        require(actual[path.name]['size'] == path.stat().st_size, 'Uploaded release asset size differs')
        remote_digest = actual[path.name].get('digest')
        if remote_digest:
            require(remote_digest == 'sha256:'+digest(path), 'Uploaded release asset digest differs')
    if complete:
        gh('release','edit',tag,'--repo',repository,'--draft=false','--target',commit,'--latest')
    final = json.loads(gh('release','view',tag,'--repo',repository,'--json','isDraft,targetCommitish,assets,url'))
    require(final['isDraft'] != complete, 'Release publication state differs from verified completeness')
    print(json.dumps({'url':final['url'],'draft':final['isDraft'],'deliverables':expected},ensure_ascii=False))
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
        stream.write(f'## {"已发布" if complete else "草稿（Android 尚缺）"}\n\n{final["url"]}\n\n'+status+'\n')


if __name__ == '__main__':
    main()
