import copy
import importlib.util
import json
import os
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('qingdan_cleanup', Path(__file__).parents[1] / 'cleanup.py')
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)

REPOSITORY, RUN, COMMIT = 'owner/repo', 123, 'a' * 40
BASE = '/repos/' + REPOSITORY


def receipt_fixture():
    records = [{'name': name, 'bytes': 2048, 'sha256': 'b' * 64}
               for name in sorted(cleanup.publish.candidate_names('1.2.0', '0.2.0', True))]
    manifest = cleanup.publish.manifest_value('1.2.0', COMMIT, True,
                                              cleanup.expected_deliverables('1.2.0', '0.2.0'), records)
    manifest.update({'sourceRunId': str(RUN), 'publishingRunId': str(RUN),
                     'sourceRunUrl': f'https://github.com/{REPOSITORY}/actions/runs/{RUN}',
                     'publishingRunUrl': f'https://github.com/{REPOSITORY}/actions/runs/{RUN}',
                     'publishingCommit': COMMIT})
    return {'schema': 'qingdan-cleanup-receipt-v1', 'repository': REPOSITORY,
            'runId': RUN, 'runAttempt': 1, 'sourceCommit': COMMIT,
            'version': '1.2.0', 'androidVersion': '0.2.0',
            'publisherResult': {'url': f'https://github.com/{REPOSITORY}/releases/tag/v1.2.0', 'draft': False},
            'manifestText': cleanup.publish.encoded_json(manifest).decode()}


class FakeAPI:
    def __init__(self, receipt):
        self.run = {'id': RUN, 'head_sha': COMMIT, 'path': '.github/workflows/release.yml',
                    'status': 'completed', 'conclusion': 'success', 'event': 'push', 'run_attempt': 1,
                    'repository': {'id': 8, 'full_name': REPOSITORY},
                    'head_repository': {'id': 8, 'full_name': REPOSITORY}}
        self.release = {'id': 44, 'tag_name': 'v1.2.0', 'target_commitish': COMMIT,
                        'draft': False, 'html_url': receipt['publisherResult']['url']}
        records = cleanup.receipt_records(receipt, REPOSITORY, RUN, COMMIT)
        self.assets = [{'id': number, 'name': name, 'size': record['bytes'], 'state': 'uploaded',
                        'digest': 'sha256:' + record['sha256']}
                       for number, (name, record) in enumerate(records.items(), 300)]
        self.artifacts = [{'id': number, 'name': name, 'expired': False,
                           'url': f'https://api.github.com{BASE}/actions/artifacts/{number}',
                           'workflow_run': {'id': RUN, 'head_sha': COMMIT,
                                            'repository_id': 8, 'head_repository_id': 8}}
                          for number, name in enumerate(sorted(cleanup.allowed_names(COMMIT)), 200)]
        self.tag = {'object': {'type': 'commit', 'sha': COMMIT}}
        self.deleted, self.calls, self.missing = [], [], set()
        self.after_delete = None

    def request(self, path, method='GET', missing_ok=False):
        self.calls.append((method, path))
        if method == 'DELETE':
            assert path.startswith(BASE + '/actions/artifacts/')
            value = int(path.rsplit('/', 1)[-1])
            self.deleted.append(value)
            if self.after_delete:
                self.after_delete(self)
            return None
        if path == f'{BASE}/actions/runs/{RUN}':
            return copy.deepcopy(self.run)
        if path == f'{BASE}/releases/tags/v1.2.0':
            return copy.deepcopy(self.release)
        if path == f'{BASE}/git/ref/tags/v1.2.0':
            return copy.deepcopy(self.tag)
        if path.startswith(BASE + '/actions/artifacts/'):
            number = int(path.rsplit('/', 1)[-1])
            if number in self.missing:
                assert missing_ok
                return None
            return copy.deepcopy(next(value for value in self.artifacts if value['id'] == number))
        raise AssertionError('Unexpected API endpoint: ' + path)

    def pages(self, path, key=None):
        self.calls.append(('PAGES', path))
        if path == f'{BASE}/actions/runs/{RUN}/artifacts' and key == 'artifacts':
            return copy.deepcopy(self.artifacts)
        if path == f'{BASE}/releases/44/assets' and key is None:
            return copy.deepcopy(self.assets)
        raise AssertionError('Unscoped pagination: ' + path)


class CleanupSafety(unittest.TestCase):
    def setUp(self):
        self.receipt = receipt_fixture()
        self.api = FakeAPI(self.receipt)

    def clean(self):
        return cleanup.cleanup(self.api, self.receipt, REPOSITORY, RUN, COMMIT)

    def reject(self, message=None):
        with self.assertRaisesRegex(ValueError, message or '.'):
            self.clean()
        self.assertEqual(self.api.deleted, [])

    def change_manifest(self, change):
        manifest = json.loads(self.receipt['manifestText'])
        change(manifest)
        self.receipt['manifestText'] = cleanup.publish.encoded_json(manifest).decode()

    def test_complete_success_deletes_only_this_runs_allowlisted_artifacts_receipt_last(self):
        ids = self.clean()
        self.assertEqual(set(ids), {item['id'] for item in self.api.artifacts})
        receipt = next(item for item in self.api.artifacts if item['name'] == cleanup.RECEIPT_NAME)
        self.assertEqual(ids[-1], receipt['id'])
        self.assertTrue(all(path.startswith(BASE + '/actions/artifacts/')
                            for method, path in self.api.calls if method == 'DELETE'))
        self.assertIn(('PAGES', f'{BASE}/actions/runs/{RUN}/artifacts'), self.api.calls)
        self.assertNotIn(('PAGES', BASE + '/actions/artifacts'), self.api.calls)

    def test_failed_cancelled_partial_and_in_progress_runs_preserved(self):
        for status, conclusion in [('completed', 'failure'), ('completed', 'cancelled'),
                                   ('in_progress', None), ('queued', None), ('completed', None)]:
            with self.subTest(status=status, conclusion=conclusion):
                self.api.run.update(status=status, conclusion=conclusion)
                self.reject('completed successful')

    def test_draft_or_incomplete_publication_has_no_deletions(self):
        self.api.release['draft'] = True
        self.reject('published state')
        self.api.release['draft'] = False
        self.api.assets.pop()
        self.reject('inventory')

    def test_no_cleanup_receipt_for_publisher_draft(self):
        self.receipt['publisherResult']['draft'] = True
        self.reject('Publisher did not confirm')

    def test_wrong_names_sizes_digests_missing_digests_and_pending_uploads_preserved(self):
        for field, bad_value in [('name', 'unexpected'), ('size', 2049),
                                 ('digest', None), ('digest', 'sha256:' + 'c' * 64),
                                 ('state', 'starter')]:
            with self.subTest(field=field):
                self.api = FakeAPI(self.receipt)
                self.api.assets[0][field] = bad_value
                self.reject('inventory|size/digest')

    def test_no_digest_fallback_or_size_only_acceptance(self):
        del self.api.assets[0]['digest']
        self.reject('size/digest')

    def test_remote_manifest_must_match_exact_publisher_bytes(self):
        manifest = next(a for a in self.api.assets if a['name'] == 'RELEASE-MANIFEST.json')
        manifest['digest'] = 'sha256:' + 'd' * 64
        self.reject('size/digest')

    def test_wrong_release_source_tag_or_url_preserved(self):
        for field, value in [('target_commitish', 'b' * 40), ('tag_name', 'v1.1.9'),
                             ('html_url', 'https://example.invalid/release')]:
            with self.subTest(field=field):
                self.api = FakeAPI(self.receipt)
                self.api.release[field] = value
                self.reject('identity')

    def test_moved_tag_preserved(self):
        self.api.tag['object']['sha'] = 'b' * 40
        self.reject('tag source')

    def test_failed_original_source_after_repair_is_not_cleaned(self):
        self.change_manifest(lambda m: m.update(publishingRunId='456', publishingCommit='c' * 40))
        self.reject('this successful source')

    def test_missing_platform_not_complete(self):
        for change in [lambda m: m.update(complete=False), lambda m: m.update(missingPlatforms=['android']),
                       lambda m: m['deliverables'].pop('android'),
                       lambda m: m['requiredPlatforms'].remove('linux')]:
            with self.subTest(change=change):
                self.receipt = receipt_fixture()
                self.change_manifest(change)
                self.reject('five complete')

    def test_manifest_inventory_requires_exact_names_unique_records_valid_digests(self):
        for change in [lambda m: m['assets'].pop(),
                       lambda m: m['assets'].__setitem__(0, m['assets'][1]),
                       lambda m: m['assets'][0].update(sha256='bad'),
                       lambda m: m['assets'][0].update(bytes=True)]:
            with self.subTest(change=change):
                self.receipt = receipt_fixture()
                self.change_manifest(change)
                self.reject()

    def test_other_run_artifact_anywhere_aborts_entire_deletion_plan(self):
        self.api.artifacts[-1]['workflow_run']['id'] = 999
        self.reject('another run')

    def test_artifact_wrong_commit_repository_or_url_aborts(self):
        for field, value in [('head_sha', 'c' * 40), ('repository_id', 9), ('head_repository_id', 9)]:
            self.api = FakeAPI(self.receipt)
            self.api.artifacts[-1]['workflow_run'][field] = value
            self.reject('another run')
        self.api = FakeAPI(self.receipt)
        self.api.artifacts[-1]['url'] = 'https://api.github.com/repos/other/repo/actions/artifacts/1'
        self.reject('target')

    def test_unknown_or_duplicate_artifact_preserves_everything(self):
        self.api.artifacts[-1]['name'] = 'keep-me'
        self.reject('Unexpected temporary')
        self.api = FakeAPI(self.receipt)
        self.api.artifacts[-1]['name'] = self.api.artifacts[0]['name']
        self.reject('Duplicate temporary')

    def test_wrong_run_identity_attempt_workflow_and_fork_rejected(self):
        for field, value in [('id', 999), ('head_sha', 'c' * 40), ('run_attempt', 2),
                             ('path', '.github/workflows/release-repair.yml'), ('event', 'pull_request')]:
            self.api = FakeAPI(self.receipt)
            self.api.run[field] = value
            self.reject()
        self.api = FakeAPI(self.receipt)
        self.api.run['head_repository']['id'] = 99
        self.reject('repository')

    def test_disappearing_artifact_is_idempotent(self):
        self.api.missing.add(self.api.artifacts[0]['id'])
        deleted = self.clean()
        self.assertEqual(len(deleted), len(self.api.artifacts) - 1)
        self.assertNotIn(self.api.artifacts[0]['id'], deleted)

    def test_partially_cleaned_run_can_retry_using_same_receipt(self):
        self.api.artifacts = self.api.artifacts[-2:]
        self.assertEqual(len(self.clean()), 2)

    def test_empty_artifact_inventory_is_idempotent(self):
        self.api.artifacts = []
        self.assertEqual(self.clean(), [])

    def test_rerun_or_release_mutation_stops_further_deletes(self):
        for change in [lambda a: a.run.update(status='in_progress', conclusion=None),
                       lambda a: a.run.update(run_attempt=2),
                       lambda a: a.assets[0].update(digest='sha256:' + 'c' * 64)]:
            with self.subTest(change=change):
                self.api = FakeAPI(self.receipt)
                self.api.after_delete = change
                with self.assertRaises(ValueError):
                    self.clean()
                self.assertEqual(len(self.api.deleted), 1)

    def test_untrusted_event_cannot_invoke_cleanup(self):
        with patch.dict(os.environ, {'GITHUB_EVENT_NAME': 'workflow_dispatch'}):
            with self.assertRaisesRegex(ValueError, 'completed workflow_run'):
                cleanup.event_identity()


class ReceiptEntryPoints(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.assets = self.root / 'assets'
        self.assets.mkdir()
        self.receipt = receipt_fixture()
        manifest = json.loads(self.receipt['manifestText'])
        for record in manifest['assets']:
            (self.assets / record['name']).write_bytes(b'unit test verified publisher bytes')
        manifest['assets'] = [cleanup.publish.file_record(path) for path in sorted(self.assets.iterdir())]
        self.receipt['manifestText'] = cleanup.publish.encoded_json(manifest).decode()
        (self.assets / 'RELEASE-MANIFEST.json').write_text(self.receipt['manifestText'])
        self.result = self.root / 'publisher-result.json'
        self.result.write_text(json.dumps(self.receipt['publisherResult']))
        self.output = self.root / 'receipt.json'
        self.environment = {'GITHUB_REPOSITORY': REPOSITORY, 'GITHUB_RUN_ID': str(RUN),
                            'GITHUB_SHA': COMMIT, 'GITHUB_RUN_ATTEMPT': '1'}

    def seal(self):
        request_path = self.root / '.github/release/request.json'
        request_path.parent.mkdir(parents=True, exist_ok=True)
        request_path.write_text(json.dumps({'version': '1.2.0', 'androidVersion': '0.2.0'}))
        previous = Path.cwd()
        try:
            os.chdir(self.root)
            with patch.dict(os.environ, self.environment):
                cleanup.seal(self.assets, self.result, self.output)
        finally:
            os.chdir(previous)

    def test_publisher_receipt_round_trip_matches_all_local_and_remote_bytes(self):
        self.seal()
        receipt = json.loads(self.output.read_text())
        self.assertEqual(receipt, self.receipt)
        api = FakeAPI(receipt)
        self.assertEqual(len(cleanup.cleanup(api, receipt, REPOSITORY, RUN, COMMIT)), 10)

    def test_draft_or_failed_partial_publisher_result_emits_no_receipt(self):
        for result in [{'url': self.receipt['publisherResult']['url'], 'draft': True}, {}, None]:
            with self.subTest(result=result):
                # A failed publisher never reaches seal in the workflow. Malformed
                # or incomplete stdout also fails closed if seal is invoked directly.
                self.result.write_text(json.dumps(result or {}))
                with self.assertRaises(ValueError):
                    self.seal()
                self.assertFalse(self.output.exists())

    def test_tampered_or_extra_local_bytes_emit_no_receipt(self):
        target = self.assets / 'SHA256SUMS-android.txt'
        target.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'bytes differ'):
            self.seal()
        self.assertFalse(self.output.exists())
        (self.assets / 'unexpected.txt').write_text('extra')
        with self.assertRaisesRegex(ValueError, 'inventory differs'):
            self.seal()
        self.assertFalse(self.output.exists())

    def test_inspect_missing_receipt_is_safe_noop_on_retry(self):
        api = FakeAPI(self.receipt)
        api.artifacts = []
        output = self.root / 'output.txt'
        with patch.dict(os.environ, {'GH_TOKEN': 'synthetic', 'GITHUB_OUTPUT': str(output)}), \
             patch.object(cleanup, 'event_identity', return_value=(REPOSITORY, RUN, COMMIT, 1)), \
             patch.object(cleanup, 'API', return_value=api):
            cleanup.main(['inspect'])
        self.assertEqual(output.read_text(), 'receipt-present=false\n')
        self.assertEqual(api.deleted, [])

    def test_delete_entry_requires_event_attempt_matching_receipt(self):
        self.seal()
        api = FakeAPI(self.receipt)
        with patch.dict(os.environ, {'GH_TOKEN': 'synthetic'}), \
             patch.object(cleanup, 'event_identity', return_value=(REPOSITORY, RUN, COMMIT, 2)), \
             patch.object(cleanup, 'API', return_value=api), \
             self.assertRaisesRegex(ValueError, 'event attempt'):
            cleanup.main(['delete', '--receipt', str(self.output)])
        self.assertEqual(api.deleted, [])

    def test_completed_event_requires_same_repository_and_terminal_success(self):
        api = FakeAPI(self.receipt)
        event = {'action': 'completed', 'workflow_run': api.run, 'repository': {'id': 8}}
        path = self.root / 'event.json'
        environment = {'GITHUB_EVENT_NAME': 'workflow_run', 'GITHUB_EVENT_PATH': str(path),
                       'GITHUB_REPOSITORY': REPOSITORY}
        path.write_text(json.dumps(event))
        with patch.dict(os.environ, environment):
            self.assertEqual(cleanup.event_identity(), (REPOSITORY, RUN, COMMIT, 1))
            event['repository']['id'] = 9
            path.write_text(json.dumps(event))
            with self.assertRaisesRegex(ValueError, 'Event repository'):
                cleanup.event_identity()


class APIBoundary(unittest.TestCase):
    def setUp(self):
        self.api = cleanup.API(REPOSITORY, 'synthetic-not-a-real-token')

    def test_no_release_assets_run_logs_or_global_deletes(self):
        for path in [BASE + '/releases/assets/123', BASE + '/actions/runs/123',
                     BASE + '/actions/runs/123/logs', BASE + '/actions/artifacts',
                     BASE + '/actions/artifacts/123?x=1', '/repos/other/repo/actions/artifacts/123']:
            with self.subTest(path=path), patch.object(self.api.opener, 'open') as network:
                with self.assertRaises(ValueError):
                    self.api.request(path, method='DELETE')
                network.assert_not_called()

    def test_unexpected_absolute_targets_and_traversal_rejected(self):
        for path in ['https://api.github.com' + BASE + '/actions/artifacts/123',
                     BASE + '/../../actions/artifacts/123', BASE + '/actions/artifacts/123#fragment',
                     BASE + '/actions\\artifacts/123']:
            with self.subTest(path=path), patch.object(self.api.opener, 'open') as network:
                with self.assertRaises(ValueError):
                    self.api.request(path)
                network.assert_not_called()

    def test_redirects_never_followed(self):
        for url in ['https://evil.invalid/', 'https://api.github.com/repos/other/repo',
                    'https://api.github.com' + BASE + '/actions/artifacts/456']:
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, 'redirects'):
                cleanup.NoRedirect().redirect_request(None, None, 302, '', {}, url)

    def test_delete_404_is_success_but_403_fails(self):
        path = BASE + '/actions/artifacts/123'
        for code in [404, 403]:
            error = urllib.error.HTTPError(cleanup.ORIGIN + path, code, 'test', {}, None)
            with patch.object(self.api.opener, 'open', side_effect=error):
                if code == 404:
                    self.assertIsNone(self.api.request(path, method='DELETE', missing_ok=True))
                else:
                    with self.assertRaises(urllib.error.HTTPError):
                        self.api.request(path, method='DELETE', missing_ok=True)

    def test_full_pagination_uses_only_constructed_run_urls(self):
        values = [{'id': i} for i in range(1, 106)]
        pages = [{'total_count': 105, 'artifacts': values[:100]},
                 {'total_count': 105, 'artifacts': values[100:]}]
        path = f'{BASE}/actions/runs/{RUN}/artifacts'
        with patch.object(self.api, 'request', side_effect=pages) as request:
            self.assertEqual(self.api.pages(path, 'artifacts'), values)
        self.assertEqual([call.args[0] for call in request.call_args_list],
                         [path + '?per_page=100&page=1', path + '?per_page=100&page=2'])

    def test_duplicate_missing_and_changing_pages_fail_closed(self):
        values = [{'id': i} for i in range(1, 101)]
        for second in [{'total_count': 101, 'artifacts': [{'id': 1}]},
                       {'total_count': 101, 'artifacts': []},
                       {'total_count': 100, 'artifacts': [{'id': 101}]}]:
            with self.subTest(second=second):
                pages = [{'total_count': 101, 'artifacts': values}, second]
                with patch.object(self.api, 'request', side_effect=pages), self.assertRaises(ValueError):
                    self.api.pages(f'{BASE}/actions/runs/{RUN}/artifacts', 'artifacts')

    def test_release_assets_paginate_until_short_page(self):
        values = [{'id': i} for i in range(1, 102)]
        with patch.object(self.api, 'request', side_effect=[values[:100], values[100:]]) as request:
            self.assertEqual(self.api.pages(BASE + '/releases/44/assets'), values)
            self.assertEqual(request.call_count, 2)


class WorkflowContract(unittest.TestCase):
    def test_every_upload_has_one_day_retention(self):
        workflows = Path(__file__).parents[2] / 'workflows'
        count = 0
        for path in workflows.glob('*.yml'):
            steps = path.read_text().split('      - ')
            for step in steps:
                if 'uses: actions/upload-artifact@' in step:
                    count += 1
                    self.assertIn('retention-days: 1\n', step, str(path))
        self.assertEqual(count, 9)

    def test_cleanup_only_triggered_after_terminal_success_and_write_scope_is_one_job(self):
        workflows = Path(__file__).parents[2] / 'workflows'
        text = (workflows / 'release-cleanup.yml').read_text()
        self.assertIn('workflow_run:', text)
        self.assertIn("workflows: ['青单发布']", text)
        self.assertIn('types: [completed]', text)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", text)
        self.assertNotIn('workflow_dispatch:', text)
        self.assertIn('group: release-cleanup-', text)
        self.assertNotIn('group: release-${{', text)
        self.assertIn('run-id: ${{ github.event.workflow_run.id }}', text)
        self.assertIn('persist-credentials: false', text)
        for path in workflows.glob('*.yml'):
            if path.name != 'release-cleanup.yml':
                self.assertNotIn('actions: write', path.read_text())
        self.assertEqual(text.count('actions: write'), 1)
        self.assertNotIn('actions: write', text.split('jobs:')[0])

    def test_receipt_only_after_successful_complete_publish_no_failure_override(self):
        workflows = Path(__file__).parents[2] / 'workflows'
        text = (workflows / 'release.yml').read_text()
        self.assertLess(text.index('publish.py --assets'), text.index('cleanup.py seal'))
        self.assertLess(text.index('cleanup.py seal'), text.index('name: verified-release-publication'))
        self.assertIn('> publish-result.json', text)
        self.assertGreaterEqual(text.count("if: success() && needs.package-android.result == 'success'"), 2)
        self.assertNotIn('continue-on-error:', text)
        self.assertNotIn('cleanup.py delete', text)
        self.assertNotIn('cleanup.py', (workflows / 'release-repair.yml').read_text())


if __name__ == '__main__':
    unittest.main()
