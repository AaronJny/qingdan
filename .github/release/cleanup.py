#!/usr/bin/env python3
"""Delete only a completed, successful release run's verified temporary artifacts.

The publisher creates a receipt after publish.py returns successfully. A separate
workflow_run(completed) job revalidates that receipt against the live Release before
any DELETE. Release assets, run logs/history and failed source runs are never deleted.
"""
import argparse
import importlib.util
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

_spec = importlib.util.spec_from_file_location('cleanup_publish', Path(__file__).with_name('publish.py'))
publish = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(publish)
require = publish.require
RECEIPT_NAME = 'verified-release-publication'
PLATFORMS = list(publish.PLATFORMS)
ORIGIN = 'https://api.github.com'


def positive(value):
    return type(value) is int and value > 0


def identity(repository, run_id, commit):
    require(isinstance(repository, str) and re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository)
            and all(part not in ('.', '..') for part in repository.split('/')), 'Invalid repository')
    require(positive(run_id), 'Invalid source run ID')
    require(isinstance(commit, str) and re.fullmatch(r'[0-9a-f]{40}', commit), 'Invalid source commit')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('GitHub API redirects are not allowed')


class API:
    def __init__(self, repository, token):
        self.base = f'/repos/{repository}'
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, path, method='GET', missing_ok=False):
        # Every URL is constructed locally. Never use artifact-provided URLs or Link URLs.
        require(path.startswith(self.base + '/') and not re.search(r'[\\#\s]', path)
                and '..' not in path and '://' not in path, 'Unexpected API target')
        require(method == 'GET' or (method == 'DELETE' and re.fullmatch(
            re.escape(self.base) + r'/actions/artifacts/[1-9][0-9]*', path)),
            'Only temporary Actions artifacts may be deleted')
        url = ORIGIN + path
        request = urllib.request.Request(url, method=method, headers={
            'Authorization': f'Bearer {self.token}', 'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'qingdan-verified-release-cleanup'})
        try:
            with self.opener.open(request, timeout=30) as response:
                require(response.geturl() == url, 'Unexpected API response target')
                expected_status = 204 if method == 'DELETE' else 200
                require(response.status == expected_status, 'Unexpected GitHub API response status')
                if method == 'DELETE':
                    return None
                return json.load(response)
        except urllib.error.HTTPError as error:
            if missing_ok and method in ('GET', 'DELETE') and error.code == 404:
                return None
            raise

    def pages(self, path, key=None):
        """Snapshot all pages before mutation; count/duplicate checks fail closed."""
        result, seen, total = [], set(), None
        for page in range(1, 101):
            data = self.request(f'{path}?per_page=100&page={page}')
            if key:
                require(isinstance(data, dict) and type(data.get('total_count')) is int,
                        'Invalid paginated artifact response')
                if total is None:
                    total = data['total_count']
                    require(0 <= total <= 10000, 'Artifact inventory exceeds cleanup bound')
                require(data['total_count'] == total, 'Artifact inventory changed during pagination')
                batch = data.get(key)
            else:
                batch = data
            require(isinstance(batch, list) and len(batch) <= 100, 'Invalid API page')
            for item in batch:
                require(isinstance(item, dict) and positive(item.get('id')) and item['id'] not in seen,
                        'Invalid or duplicate paginated ID')
                seen.add(item['id'])
            result.extend(batch)
            if len(batch) < 100 or (total is not None and len(result) == total):
                require(total is None or len(result) == total, 'Incomplete artifact pagination')
                return result
        raise ValueError('Pagination exceeds cleanup bound')


def verify_run(run, repository, run_id, commit, attempt=None):
    identity(repository, run_id, commit)
    require(run.get('id') == run_id and run.get('head_sha') == commit
            and run.get('path') == '.github/workflows/release.yml', 'Run source identity differs')
    require(run.get('status') == 'completed' and run.get('conclusion') == 'success',
            'Only completed successful release runs can be cleaned')
    require(run.get('event') in ('push', 'workflow_dispatch'), 'Unexpected release trigger')
    repo, head = run.get('repository', {}), run.get('head_repository', {})
    require(repo.get('full_name') == repository and head.get('full_name') == repository
            and positive(repo.get('id')) and head.get('id') == repo['id'], 'Run repository identity differs')
    require(positive(run.get('run_attempt')) and (attempt is None or run['run_attempt'] == attempt),
            'Run attempt differs from verified publication')
    return repo['id']


def expected_deliverables(version, android_version):
    return publish.expected_deliverables(version, android_version)


def allowed_names(commit):
    return {RECEIPT_NAME, 'verified-application', 'backend-verification',
            'backend-verification-native-windows',
            'backend-verification-native-macos-arm64', 'backend-verification-native-macos-x64',
            *[f'{platform}-{commit}' for platform in PLATFORMS]}


class CurrentReleasePolicy:
    """Only the explicit current six-target inventory. No historical fallback."""
    def inventory(self, receipt, repository, run_id, commit):
        version, android_version = receipt['version'], receipt['androidVersion']
        return (PLATFORMS, expected_deliverables(version, android_version),
                publish.candidate_names(version, android_version, True))

    def artifact_names(self, commit):
        return allowed_names(commit)


CURRENT_POLICY = CurrentReleasePolicy()


def receipt_records(receipt, repository, run_id, commit, *, policy=CURRENT_POLICY):
    identity(repository, run_id, commit)
    require(receipt.get('schema') == 'qingdan-cleanup-receipt-v1'
            and receipt.get('repository') == repository and receipt.get('runId') == run_id
            and receipt.get('sourceCommit') == commit and positive(receipt.get('runAttempt')),
            'Publication receipt identity differs')
    version, android_version = receipt.get('version'), receipt.get('androidVersion')
    require(all(isinstance(v, str) and re.fullmatch(r'\d+\.\d+\.\d+', v)
                for v in (version, android_version)), 'Invalid publication versions')
    platforms, deliverables, names = policy.inventory(receipt, repository, run_id, commit)
    url = f'https://github.com/{repository}/releases/tag/v{version}'
    result = receipt.get('publisherResult', {})
    require(result.get('draft') is False and result.get('url') == url,
            'Publisher did not confirm a complete public Release')
    text = receipt.get('manifestText')
    require(isinstance(text, str), 'Missing exact publisher manifest')
    manifest = json.loads(text)
    run_url = f'https://github.com/{repository}/actions/runs/{run_id}'
    require(manifest.get('schema') == 'qingdan-release-assets-v1' and manifest.get('version') == version
            and manifest.get('complete') is True and manifest.get('missingPlatforms') == []
            and manifest.get('requiredPlatforms') == platforms
            and manifest.get('deliverables') == deliverables,
            'Release does not contain exactly the complete required targets')
    require(manifest.get('sourceCommit') == commit and manifest.get('publishingCommit') == commit
            and manifest.get('sourceRunId') == str(run_id) and manifest.get('publishingRunId') == str(run_id)
            and manifest.get('sourceRunUrl') == run_url and manifest.get('publishingRunUrl') == run_url,
            'Manifest is not tied to this successful source and publishing run')
    records = manifest.get('assets')
    require(isinstance(records, list) and len(records) == len(names),
            'Incomplete publication manifest')
    by_name = {}
    for record in records:
        require(isinstance(record, dict) and record.get('name') in names and record['name'] not in by_name
                and positive(record.get('bytes')) and isinstance(record.get('sha256'), str)
                and re.fullmatch(r'[0-9a-f]{64}', record['sha256']), 'Invalid or duplicate manifest asset')
        by_name[record['name']] = record
    require(set(by_name) == names, 'Exact publication inventory differs')
    by_name['RELEASE-MANIFEST.json'] = publish.byte_record('RELEASE-MANIFEST.json', text.encode('utf-8'))
    return by_name


def seal(assets, result_path, output):
    """Called only after publish.py succeeds; no network mutation or credentials."""
    request = json.loads(Path('.github/release/request.json').read_text())
    root = Path(assets)
    receipt = {'schema': 'qingdan-cleanup-receipt-v1', 'repository': os.environ['GITHUB_REPOSITORY'],
               'runId': int(os.environ['GITHUB_RUN_ID']), 'runAttempt': int(os.environ['GITHUB_RUN_ATTEMPT']),
               'sourceCommit': os.environ['GITHUB_SHA'], 'version': request['version'],
               'androidVersion': request['androidVersion'],
               'publisherResult': json.loads(Path(result_path).read_text()),
               'manifestText': (root / 'RELEASE-MANIFEST.json').read_bytes().decode('utf-8')}
    records = receipt_records(receipt, receipt['repository'], receipt['runId'], receipt['sourceCommit'])
    require({path.name for path in root.iterdir()} == set(records), 'Local publication inventory differs')
    for name, record in records.items():
        path = root / name
        require(path.is_file() and not path.is_symlink() and publish.file_record(path) == record,
                'Local published bytes differ from receipt')
    Path(output).write_bytes(publish.encoded_json(receipt))


def verify_release(api, receipt, repository, run_id, commit, *, policy=CURRENT_POLICY):
    records = receipt_records(receipt, repository, run_id, commit, policy=policy)
    base = f'/repos/{repository}'
    tag = 'v' + receipt['version']
    release = api.request(f'{base}/releases/tags/{tag}')
    require(positive(release.get('id')) and release.get('tag_name') == tag
            and release.get('target_commitish') == commit and release.get('draft') is False
            and release.get('html_url') == receipt['publisherResult']['url'],
            'Release identity, source or published state differs')
    actual = api.pages(f'{base}/releases/{release["id"]}/assets')
    require(len(actual) == len(records) and {asset.get('name') for asset in actual} == set(records),
            'Exact remote Release asset inventory differs')
    for asset in actual:
        require(asset.get('state') == 'uploaded' and publish.same_bytes(asset, records[asset['name']]),
                'Remote Release asset size/digest or upload state differs')
    # Confirm the public tag still resolves to the verified commit, including annotated tags.
    obj = api.request(f'{base}/git/ref/tags/{tag}').get('object', {})
    seen = set()
    while obj.get('type') == 'tag':
        sha = obj.get('sha')
        require(isinstance(sha, str) and re.fullmatch(r'[0-9a-f]{40}', sha)
                and sha not in seen and len(seen) < 10, 'Invalid annotated release tag')
        seen.add(sha)
        obj = api.request(f'{base}/git/tags/{sha}').get('object', {})
    require(obj.get('type') == 'commit' and obj.get('sha') == commit, 'Release tag source differs')


def verify_artifact(artifact, repository, repository_id, run_id, commit, *, policy=CURRENT_POLICY):
    require(positive(artifact.get('id')) and artifact.get('name') in policy.artifact_names(commit),
            'Unexpected temporary artifact; preserve the run')
    source = artifact.get('workflow_run', {})
    require(source.get('id') == run_id and source.get('head_sha') == commit
            and source.get('repository_id') == repository_id and source.get('head_repository_id') == repository_id,
            'Artifact belongs to another run, source or repository')
    require(artifact.get('url') == f'{ORIGIN}/repos/{repository}/actions/artifacts/{artifact["id"]}',
            'Unexpected artifact API target')


def inspect(api, repository, run_id, commit, attempt=None, *, policy=CURRENT_POLICY):
    base = f'/repos/{repository}'
    run = api.request(f'{base}/actions/runs/{run_id}')
    repo_id = verify_run(run, repository, run_id, commit, attempt)
    artifacts = api.pages(f'{base}/actions/runs/{run_id}/artifacts', 'artifacts')
    names = set()
    for artifact in artifacts:
        verify_artifact(artifact, repository, repo_id, run_id, commit, policy=policy)
        require(artifact['name'] not in names, 'Duplicate temporary artifact name')
        names.add(artifact['name'])
    return run, artifacts


def cleanup(api, receipt, repository, run_id, commit, *, policy=CURRENT_POLICY):
    # All evidence and the entire deletion set pass before the first deletion.
    receipt_records(receipt, repository, run_id, commit, policy=policy)
    _, artifacts = inspect(api, repository, run_id, commit, receipt['runAttempt'], policy=policy)
    verify_release(api, receipt, repository, run_id, commit, policy=policy)
    base = f'/repos/{repository}'
    removed = []
    # Delete receipt last so an interrupted cleanup can be retried safely.
    for artifact in sorted(artifacts, key=lambda value: value['name'] == RECEIPT_NAME):
        current = api.request(f'{base}/actions/runs/{run_id}')
        repo_id = verify_run(current, repository, run_id, commit, receipt['runAttempt'])
        path = f'{base}/actions/artifacts/{artifact["id"]}'
        live = api.request(path, missing_ok=True)
        if live is None:
            continue
        verify_artifact(live, repository, repo_id, run_id, commit, policy=policy)
        require(live['id'] == artifact['id'] and live['name'] == artifact['name'],
                'Artifact identity changed before deletion')
        # Recheck the release immediately before every irreversible artifact DELETE.
        verify_release(api, receipt, repository, run_id, commit, policy=policy)
        verify_run(api.request(f'{base}/actions/runs/{run_id}'), repository, run_id, commit, receipt['runAttempt'])
        api.request(path, method='DELETE', missing_ok=True)
        removed.append(artifact['id'])
    return removed


def event_identity():
    require(os.environ.get('GITHUB_EVENT_NAME') == 'workflow_run', 'Cleanup requires a completed workflow_run event')
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    require(event.get('action') == 'completed', 'Cleanup event is not completed')
    run = event.get('workflow_run', {})
    repository = os.environ['GITHUB_REPOSITORY']
    verify_run(run, repository, run.get('id'), run.get('head_sha'))
    require(event.get('repository', {}).get('id') == run['repository']['id'], 'Event repository differs')
    return repository, run['id'], run['head_sha'], run['run_attempt']


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    sealing = commands.add_parser('seal')
    sealing.add_argument('--assets', required=True)
    sealing.add_argument('--result', required=True)
    sealing.add_argument('--output', required=True)
    commands.add_parser('inspect')
    deleting = commands.add_parser('delete')
    deleting.add_argument('--receipt', required=True)
    args = parser.parse_args(argv)
    if args.command == 'seal':
        seal(args.assets, args.result, args.output)
        return
    repository, run_id, commit, attempt = event_identity()
    api = API(repository, os.environ['GH_TOKEN'])
    if args.command == 'inspect':
        _, artifacts = inspect(api, repository, run_id, commit, attempt)
        present = any(item['name'] == RECEIPT_NAME and item.get('expired') is False for item in artifacts)
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            stream.write(f'receipt-present={str(present).lower()}\n')
        print('Verified publication receipt available.' if present else 'No receipt remains; preserving any other artifacts.')
        return
    receipt = json.loads(Path(args.receipt).read_text())
    require(receipt.get('runAttempt') == attempt, 'Receipt differs from completed event attempt')
    removed = cleanup(api, receipt, repository, run_id, commit)
    print(f'Removed {len(removed)} temporary artifacts from successful release run {run_id}; Release assets and logs preserved.')


if __name__ == '__main__':
    main()
