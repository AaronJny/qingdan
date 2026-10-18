#!/usr/bin/env python3
"""One-time, hash-pinned cleanup of the approved successful v1.1.2 build only.

This adapter does not alter or relax cleanup.py. Its receipt is reconstructed from
an independently verified, byte-exact published manifest; its scope is narrower
than normal cleanup: one repository, one run/attempt, one Release and nine IDs.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path

_spec = importlib.util.spec_from_file_location('legacy_cleanup_core', Path(__file__).with_name('cleanup.py'))
cleanup = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cleanup)
require = cleanup.require
REPOSITORY = 'AaronJny/qingdan'
REPOSITORY_ID = 1411240828
RUN_ID = 39044915950
COMMIT = 'eb92ddcc6f84baf803320ad6ebc3033b623e2944'
RELEASE_ID = 415884140
ARTIFACT_IDS = frozenset({12105920373, 12105536185, 12105293013, 12105253613,
                          12105223326, 12105203744, 12105168562, 12105059404, 12104739535})
REQUEST_PATH = Path(__file__).with_name('legacy-cleanup-request.json')
REQUEST_SHA256 = '1e5753295cc682bb8e9dc5fddcc47e0228d4361b11af432d85574b3c19088fb5'
BASE = f'/repos/{REPOSITORY}'


class ImmutableLegacyPolicy:
    """Explicit historical contract, usable only for the one approved source."""
    def inventory(self, receipt, repository, run_id, commit):
        require(repository == REPOSITORY and run_id == RUN_ID and commit == COMMIT
                and receipt.get('version') == '1.1.2' and receipt.get('androidVersion') == '0.1.2'
                and receipt.get('runAttempt') == 1, 'Legacy policy source differs')
        require(hashlib.sha256(receipt.get('manifestText', '').encode('utf-8')).hexdigest() ==
                '5dc4eee13df36498e93f4e96d6f24f425f258c531c3caf5bd3f83ea76ec479c4',
                'Legacy policy requires the exact immutable published manifest')
        platforms = ['macos', 'windows', 'server', 'linux', 'android']
        deliverables = {'macos': 'Qingdan-1.1.2-mac-arm64.dmg',
                        'windows': 'Qingdan-1.1.2-win-x64.zip',
                        'server': 'qingdan-server-v1.1.2.zip',
                        'linux': 'Qingdan-1.1.2-linux-x64.AppImage',
                        'android': 'Qingdan-0.1.2-android.apk'}
        # Literal historical names deliberately do not use the evolving publisher.
        names = {
            'Qingdan-1.1.2-mac-arm64.dmg', 'Qingdan-1.1.2-mac-arm64.zip',
            'verified-mac-arm64.json', 'verified-mac-arm64-archives.json',
            'backend-verification-macos.json', 'MAC-START-HERE.txt', 'SHA256SUMS-macos.txt',
            'Qingdan-1.1.2-win-x64.zip', 'verified-win-x64.json',
            'verified-win-x64-archives.json', 'backend-verification-windows.json',
            'WINDOWS-START-HERE.txt', 'SHA256SUMS-windows.txt',
            'Qingdan-1.1.2-linux-x64.AppImage', 'verified-linux-x64.json',
            'verified-linux-appimage-x64.json', 'backend-verification-linux.json',
            'LINUX-START-HERE.txt', 'SHA256SUMS-linux.txt',
            'qingdan-server-v1.1.2.zip', 'qingdan-server-v1.1.2.sha256',
            'qingdan-server-v1.1.2.verification.json', 'Qingdan-0.1.2-android.apk',
            'Qingdan-0.1.2-android.apk.verification.json', 'SHA256SUMS-android.txt',
        }
        require(len(names) == 25, 'Historical publication inventory changed')
        return platforms, deliverables, names

    def artifact_names(self, commit):
        require(commit == COMMIT, 'Legacy artifact source differs')
        return {cleanup.RECEIPT_NAME, 'verified-application', 'backend-verification',
                'backend-verification-native-windows', 'backend-verification-native-macos',
                *[f'{platform}-{COMMIT}' for platform in ('macos', 'windows', 'server', 'linux', 'android')]}


LEGACY_POLICY = ImmutableLegacyPolicy()


def receipt_records(receipt):
    return cleanup.receipt_records(receipt, REPOSITORY, RUN_ID, COMMIT, policy=LEGACY_POLICY)


def load_request(path=REQUEST_PATH):
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == REQUEST_SHA256, 'Legacy cleanup request hash differs; preserve everything')
    request = json.loads(raw)
    require(request.get('schema') == 'qingdan-legacy-cleanup-request-v1'
            and request.get('repositoryId') == REPOSITORY_ID and request.get('releaseId') == RELEASE_ID,
            'Legacy cleanup target differs')
    receipt = request['receipt']
    require(receipt.get('runAttempt') == 1 and receipt.get('version') == '1.1.2'
            and receipt.get('androidVersion') == '0.1.2', 'Legacy source attempt or version differs')
    records = receipt_records(receipt)
    require(set(request['releaseAssetIds']) == set(records)
            and all(cleanup.positive(value) for value in request['releaseAssetIds'].values())
            and len(set(request['releaseAssetIds'].values())) == 26, 'Legacy Release asset IDs differ')
    artifacts = request['artifacts']
    require(len(artifacts) == 9 and {item['id'] for item in artifacts} == ARTIFACT_IDS
            and {item['name'] for item in artifacts} == LEGACY_POLICY.artifact_names(COMMIT) - {cleanup.RECEIPT_NAME},
            'Legacy temporary artifact scope differs')
    return request


def verify_event():
    """Only a trusted main-branch push of this committed exact request may delete."""
    require(os.environ.get('GITHUB_REPOSITORY') == REPOSITORY
            and os.environ.get('GITHUB_EVENT_NAME') == 'push'
            and os.environ.get('GITHUB_REF') == 'refs/heads/main'
            and os.environ.get('GITHUB_WORKFLOW_REF') ==
            f'{REPOSITORY}/.github/workflows/release-legacy-cleanup.yml@refs/heads/main',
            'Legacy cleanup requires its trusted main-branch push workflow')
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    sha = os.environ.get('GITHUB_SHA', '')
    require(re.fullmatch(r'[0-9a-f]{40}', sha) and event.get('after') == sha
            and event.get('ref') == 'refs/heads/main' and event.get('deleted') is False
            and event.get('repository', {}).get('id') == REPOSITORY_ID
            and event.get('repository', {}).get('full_name') == REPOSITORY,
            'Legacy cleanup push event identity differs')


class ExactLegacyAPI:
    """Narrow the mature core API to the approved immutable target identifiers."""
    def __init__(self, api, request):
        self.api = api
        self.artifacts = {item['id']: item for item in request['artifacts']}
        self.release_assets = request['releaseAssetIds']
        require(set(self.artifacts) == ARTIFACT_IDS, 'Only the nine approved artifact IDs are permitted')

    def artifact(self, item):
        require(item.get('id') in ARTIFACT_IDS, 'Unapproved artifact ID; preserve the run')
        cleanup.verify_artifact(item, REPOSITORY, REPOSITORY_ID, RUN_ID, COMMIT, policy=LEGACY_POLICY)
        expected = self.artifacts[item['id']]
        require(item.get('name') == expected['name'] and item.get('size_in_bytes') == expected['bytes']
                and item.get('digest') == 'sha256:' + expected['sha256'],
                'Approved temporary artifact name, size or digest changed')

    def request(self, path, method='GET', missing_ok=False):
        artifact = re.fullmatch(re.escape(BASE) + r'/actions/artifacts/([1-9][0-9]*)', path)
        if artifact:
            require(int(artifact[1]) in ARTIFACT_IDS, 'Unapproved artifact API target')
        if method == 'DELETE':
            require(artifact is not None, 'Legacy cleanup may only delete the nine approved artifacts')
        else:
            require(method == 'GET' and (artifact is not None or path in {
                f'{BASE}/actions/runs/{RUN_ID}', f'{BASE}/releases/tags/v1.1.2',
                f'{BASE}/git/ref/tags/v1.1.2'} or
                re.fullmatch(re.escape(BASE) + r'/git/tags/[0-9a-f]{40}', path)),
                'Unexpected legacy API target')
        result = self.api.request(path, method=method, missing_ok=missing_ok)
        if method == 'GET' and result is not None:
            if artifact:
                require(result.get('id') == int(artifact[1]), 'Artifact response ID differs from requested ID')
                self.artifact(result)
            elif path == f'{BASE}/releases/tags/v1.1.2':
                require(result.get('id') == RELEASE_ID, 'Legacy Release ID changed')
            elif path == f'{BASE}/actions/runs/{RUN_ID}':
                require(cleanup.verify_run(result, REPOSITORY, RUN_ID, COMMIT, 1) == REPOSITORY_ID,
                        'Legacy source repository ID changed')
        return result

    def pages(self, path, key=None):
        require((path, key) in {(f'{BASE}/actions/runs/{RUN_ID}/artifacts', 'artifacts'),
                                (f'{BASE}/releases/{RELEASE_ID}/assets', None)},
                'Unexpected legacy pagination target')
        result = self.api.pages(path, key)
        if key == 'artifacts':
            require(len({item.get('id') for item in result}) == len(result), 'Duplicate legacy artifact ID')
            for item in result:
                self.artifact(item)
        else:
            require(len(result) == 26 and {item.get('name'): item.get('id') for item in result} == self.release_assets,
                    'Legacy Release asset IDs or names changed')
        return result


def execute(api, request, delete=False):
    scoped = ExactLegacyAPI(api, request)
    receipt = request['receipt']
    if delete:
        # Core verifies all evidence before any mutation, then rechecks Release
        # inventory/digests, tag and terminal run state before every artifact DELETE.
        return cleanup.cleanup(scoped, receipt, REPOSITORY, RUN_ID, COMMIT, policy=LEGACY_POLICY)
    cleanup.inspect(scoped, REPOSITORY, RUN_ID, COMMIT, 1, policy=LEGACY_POLICY)
    cleanup.verify_release(scoped, receipt, REPOSITORY, RUN_ID, COMMIT, policy=LEGACY_POLICY)
    return []


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--delete', action='store_true', help='Execute only the exact committed approved request')
    args = parser.parse_args(argv)
    request = load_request()
    verify_event()
    api = cleanup.API(REPOSITORY, os.environ['GH_TOKEN'])
    removed = execute(api, request, delete=args.delete)
    print(json.dumps({'runId': RUN_ID, 'release': 'v1.1.2', 'removedArtifactIds': removed,
                      'verifiedOnly': not args.delete, 'releaseAssetsAndLogsPreserved': True}))


if __name__ == '__main__':
    main()
