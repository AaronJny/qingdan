#!/usr/bin/env python3
"""Recover publication only from a fully verified, unchanged build snapshot."""
import json
import os
import re
import subprocess
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def api(endpoint):
    return json.loads(subprocess.check_output(['gh', 'api', endpoint], text=True))


def verify_request(request, run, jobs, artifacts, comparison):
    source, run_id = request.get('sourceCommit'), request.get('runId')
    require(isinstance(source, str) and re.fullmatch(r'[0-9a-f]{40}', source), 'Invalid original build source')
    require(type(run_id) is int and run_id > 0 and type(request.get('attempt')) is int and request['attempt'] > 0, 'Invalid explicit publication repair request')
    require(run.get('id') == run_id and run.get('head_sha') == source and run.get('path') == '.github/workflows/release.yml' and run.get('status') == 'completed', 'Repair must reference the completed release build at the exact source')
    required_jobs = {
        '发布版本与明确请求', '完整检查 / 源码与运行包检查',
        '完整检查 / 内置后端原生系统检查 (windows)', '完整检查 / 内置后端原生系统检查 (macos)',
        'Android 可安装发布 APK', 'Windows x64', 'macOS arm64',
        'Linux x64 客户端 AppImage', '独立服务端 Linux 与 macOS 运行时',
    }
    by_name = {job['name']: job for job in jobs}
    require(len(by_name) == len(jobs), 'Unexpected duplicate build jobs')
    require(required_jobs.issubset(by_name) and all(by_name[name].get('conclusion') == 'success' for name in required_jobs), 'All original source/native/build/packaging gates must have succeeded')
    require(all(job.get('conclusion') == 'success' or job['name'] == '汇总成品并发布（缺 APK 时仅草稿）' for job in jobs), 'Only the original publication step may have failed')
    expected = {f'{platform}-{source}' for platform in ('android', 'windows', 'macos', 'linux', 'server')}
    packaged = [artifact for artifact in artifacts if artifact.get('name', '').endswith('-' + source)]
    require({artifact['name'] for artifact in packaged} == expected and len(packaged) == 5 and all(not artifact.get('expired') for artifact in packaged), 'Exact five original packaged artifacts must remain available')
    require(all(artifact.get('workflow_run', {}).get('head_sha', source) == source for artifact in packaged), 'Artifact source differs from original verified build')
    require(comparison.get('status') in ('ahead', 'identical') and comparison.get('total_commits', 0) <= 100, 'Repair code must descend from original build source')
    files = comparison.get('files', [])
    require(len(files) < 300 and all(file['filename'].startswith('.github/release/') or file['filename'] == '.github/workflows/release-repair.yml' for file in files), 'Application/build workflow changed after original build; rebuild instead of reusing artifacts')
    return source, run_id


def main():
    request = json.loads(Path('.github/release/repair-request.json').read_text())
    repository = os.environ['GITHUB_REPOSITORY']
    require(re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository), 'Invalid repository')
    source, run_id = request.get('sourceCommit'), request.get('runId')
    require(isinstance(source, str) and re.fullmatch(r'[0-9a-f]{40}', source) and type(run_id) is int and run_id > 0, 'Invalid original build reference')
    base = f'repos/{repository}'
    run = api(f'{base}/actions/runs/{run_id}')
    jobs = api(f'{base}/actions/runs/{run_id}/jobs?filter=latest&per_page=100')
    artifacts = api(f'{base}/actions/runs/{run_id}/artifacts?per_page=100')
    require(jobs.get('total_count', 0) <= 100 and artifacts.get('total_count', 0) <= 100, 'Original inventory is too large for bounded recovery')
    comparison = api(f'{base}/compare/{source}...{os.environ["GITHUB_SHA"]}')
    source, run_id = verify_request(request, run, jobs['jobs'], artifacts['artifacts'], comparison)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
        stream.write(f'source-commit={source}\nsource-run-id={run_id}\n')
    print('All five original artifacts and native/source gates passed; only publication tooling changed.')


if __name__ == '__main__':
    main()
