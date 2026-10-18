import copy
import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('qingdan_legacy_cleanup', Path(__file__).parents[1] / 'legacy_cleanup.py')
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)


class FakeAPI:
    def __init__(self, request):
        self.run = {'id': legacy.RUN_ID, 'head_sha': legacy.COMMIT, 'run_attempt': 1,
                    'path': '.github/workflows/release.yml', 'event': 'push',
                    'status': 'completed', 'conclusion': 'success',
                    'repository': {'id': legacy.REPOSITORY_ID, 'full_name': legacy.REPOSITORY},
                    'head_repository': {'id': legacy.REPOSITORY_ID, 'full_name': legacy.REPOSITORY}}
        self.release = {'id': legacy.RELEASE_ID, 'tag_name': 'v1.1.2', 'draft': False,
                        'target_commitish': legacy.COMMIT,
                        'html_url': request['receipt']['publisherResult']['url']}
        records = legacy.receipt_records(request['receipt'])
        self.assets = [{'id': request['releaseAssetIds'][name], 'name': name, 'size': value['bytes'],
                        'digest': 'sha256:' + value['sha256'], 'state': 'uploaded'}
                       for name, value in records.items()]
        self.artifacts = [{'id': a['id'], 'name': a['name'], 'size_in_bytes': a['bytes'],
                           'digest': 'sha256:' + a['sha256'], 'expired': False,
                           'url': f'{legacy.cleanup.ORIGIN}{legacy.BASE}/actions/artifacts/{a["id"]}',
                           'workflow_run': {'id': legacy.RUN_ID, 'head_sha': legacy.COMMIT,
                                            'repository_id': legacy.REPOSITORY_ID,
                                            'head_repository_id': legacy.REPOSITORY_ID}}
                          for a in request['artifacts']]
        self.tag = {'object': {'type': 'commit', 'sha': legacy.COMMIT}}
        self.calls, self.deleted = [], []
        self.absent = set()
        self.after_delete = None

    def request(self, path, method='GET', missing_ok=False):
        self.calls.append((method, path))
        if method == 'DELETE':
            artifact_id = int(path.rsplit('/', 1)[-1])
            assert artifact_id in legacy.ARTIFACT_IDS
            self.deleted.append(artifact_id)
            if self.after_delete:
                self.after_delete(self)
            return None
        if path == f'{legacy.BASE}/actions/runs/{legacy.RUN_ID}':
            return copy.deepcopy(self.run)
        if path == f'{legacy.BASE}/releases/tags/v1.1.2':
            return copy.deepcopy(self.release)
        if path == f'{legacy.BASE}/git/ref/tags/v1.1.2':
            return copy.deepcopy(self.tag)
        if path.startswith(legacy.BASE + '/actions/artifacts/'):
            artifact_id = int(path.rsplit('/', 1)[-1])
            if artifact_id in self.absent:
                assert missing_ok
                return None
            return copy.deepcopy(next(item for item in self.artifacts if item['id'] == artifact_id))
        raise AssertionError(path)

    def pages(self, path, key=None):
        self.calls.append(('PAGES', path))
        if path == f'{legacy.BASE}/actions/runs/{legacy.RUN_ID}/artifacts' and key == 'artifacts':
            return copy.deepcopy(self.artifacts)
        if path == f'{legacy.BASE}/releases/{legacy.RELEASE_ID}/assets' and key is None:
            return copy.deepcopy(self.assets)
        raise AssertionError(path)


class LegacyContract(unittest.TestCase):
    def setUp(self):
        self.request = legacy.load_request()
        self.api = FakeAPI(self.request)

    def execute(self, delete=True):
        return legacy.execute(self.api, self.request, delete=delete)

    def reject(self, pattern='.'):
        with self.assertRaisesRegex(ValueError, pattern):
            self.execute()
        self.assertEqual(self.api.deleted, [])

    def test_exact_approved_request_matches_hash_and_fixed_identifiers(self):
        self.assertEqual(hashlib.sha256(legacy.REQUEST_PATH.read_bytes()).hexdigest(), legacy.REQUEST_SHA256)
        self.assertEqual(self.request['receipt']['runId'], 39044915950)
        self.assertEqual(self.request['receipt']['runAttempt'], 1)
        self.assertEqual(self.request['releaseId'], 415884140)
        self.assertEqual({a['id'] for a in self.request['artifacts']}, legacy.ARTIFACT_IDS)
        manifest = self.request['receipt']['manifestText'].encode()
        self.assertEqual(len(manifest), 5225)
        self.assertEqual(hashlib.sha256(manifest).hexdigest(),
                         '5dc4eee13df36498e93f4e96d6f24f425f258c531c3caf5bd3f83ea76ec479c4')

    def test_historical_26_assets_and_nine_ids_remain_distinct_from_current_contract(self):
        records = legacy.receipt_records(self.request['receipt'])
        self.assertEqual(len(records), 26)
        self.assertEqual(len(self.api.assets), 26)
        self.assertEqual(len(json.loads(self.request['receipt']['manifestText'])['assets']), 25)
        self.assertIn('backend-verification-macos.json', records)
        self.assertIn('SHA256SUMS-macos.txt', records)
        self.assertFalse(any('mac-x64' in name or 'macos-x64' in name for name in records))
        self.assertIn('macos-' + legacy.COMMIT, legacy.LEGACY_POLICY.artifact_names(legacy.COMMIT))
        self.assertNotIn('macos-' + legacy.COMMIT, legacy.cleanup.allowed_names(legacy.COMMIT))
        self.assertEqual(len(self.execute()), 9)
        self.assertEqual(len(self.api.assets), 26)

    def test_legacy_policy_cannot_be_reused_for_another_source_or_manifest(self):
        receipt = self.request['receipt']
        for repository, run_id, commit in [('other/repo', legacy.RUN_ID, legacy.COMMIT),
                                          (legacy.REPOSITORY, legacy.RUN_ID + 1, legacy.COMMIT),
                                          (legacy.REPOSITORY, legacy.RUN_ID, 'a' * 40)]:
            with self.subTest(repository=repository, run_id=run_id, commit=commit), self.assertRaises(ValueError):
                legacy.LEGACY_POLICY.inventory(receipt, repository, run_id, commit)
        altered = copy.deepcopy(receipt)
        altered['manifestText'] += '\n'
        with self.assertRaisesRegex(ValueError, 'exact immutable'):
            legacy.receipt_records(altered)
        self.assertEqual(self.api.calls, [])

    def test_any_request_change_requires_a_new_reviewed_code_hash(self):
        for mutate in [lambda r: r['receipt'].update(runId=999),
                       lambda r: r.update(releaseId=999),
                       lambda r: r['artifacts'][0].update(id=999),
                       lambda r: r['receipt'].update(manifestText='{}')]:
            with tempfile.TemporaryDirectory() as temp:
                request = copy.deepcopy(self.request)
                mutate(request)
                path = Path(temp) / 'request.json'
                path.write_text(json.dumps(request))
                with self.assertRaisesRegex(ValueError, 'request hash differs'):
                    legacy.load_request(path)
        self.assertEqual(self.api.calls, [])

    def test_dry_run_never_deletes(self):
        self.assertEqual(self.execute(False), [])
        self.assertEqual(self.api.deleted, [])
        self.assertIn(('PAGES', f'{legacy.BASE}/releases/{legacy.RELEASE_ID}/assets'), self.api.calls)

    def test_success_deletes_exactly_nine_ids_and_no_other_endpoint(self):
        self.assertEqual(set(self.execute()), legacy.ARTIFACT_IDS)
        self.assertEqual(len(self.api.deleted), 9)
        deleted = [path for method, path in self.api.calls if method == 'DELETE']
        self.assertEqual(set(deleted), {f'{legacy.BASE}/actions/artifacts/{i}' for i in legacy.ARTIFACT_IDS})
        for index, (method, _) in enumerate(self.api.calls):
            if method == 'DELETE':
                self.assertEqual(self.api.calls[index - 1], ('GET', f'{legacy.BASE}/actions/runs/{legacy.RUN_ID}'))
                self.assertEqual(self.api.calls[index - 2], ('GET', f'{legacy.BASE}/git/ref/tags/v1.1.2'))
        self.assertEqual(sum(path == f'{legacy.BASE}/releases/{legacy.RELEASE_ID}/assets'
                             for method, path in self.api.calls), 10)

    def test_failed_in_progress_cancelled_or_retried_source_is_preserved(self):
        for change in [{'conclusion': 'failure'}, {'conclusion': 'cancelled'},
                       {'status': 'in_progress'}, {'run_attempt': 2}, {'head_sha': 'a' * 40}]:
            with self.subTest(change=change):
                self.api = FakeAPI(self.request)
                self.api.run.update(change)
                self.reject()

    def test_same_names_from_other_run_or_repository_are_preserved(self):
        for key, value in [('id', 999), ('repository_id', 999), ('head_repository_id', 999),
                           ('head_sha', 'a' * 40)]:
            with self.subTest(key=key):
                self.api = FakeAPI(self.request)
                self.api.artifacts[-1]['workflow_run'][key] = value
                self.reject('another run')

    def test_new_artifact_id_with_approved_name_is_not_in_scope(self):
        self.api.artifacts[-1]['id'] = 999
        self.reject('Unapproved artifact ID')

    def test_artifact_name_size_digest_mutation_preserves_entire_run(self):
        for key, value in [('name', 'keep-me'), ('size_in_bytes', 1), ('digest', None),
                           ('digest', 'sha256:' + 'a' * 64)]:
            with self.subTest(key=key):
                self.api = FakeAPI(self.request)
                self.api.artifacts[-1][key] = value
                self.reject()

    def test_duplicate_artifact_ids_fail_before_first_delete(self):
        self.api.artifacts[-1] = copy.deepcopy(self.api.artifacts[0])
        self.reject('Duplicate legacy')

    def test_release_recreated_same_tag_is_preserved(self):
        self.api.release['id'] = 999
        self.reject('Release ID changed')

    def test_replaced_asset_same_name_and_digest_but_new_id_is_preserved(self):
        self.api.assets[-1]['id'] = 999
        self.reject('asset IDs or names changed')

    def test_incomplete_draft_wrong_source_or_modified_release_fails_closed(self):
        for change in [lambda a: a.assets.pop(), lambda a: a.release.update(draft=True),
                       lambda a: a.release.update(target_commitish='a' * 40),
                       lambda a: a.assets[0].update(digest=None),
                       lambda a: a.assets[0].update(digest='sha256:' + 'a' * 64),
                       lambda a: a.assets[0].update(size=1),
                       lambda a: a.assets[0].update(state='starter'),
                       lambda a: a.tag['object'].update(sha='a' * 40)]:
            with self.subTest(change=change):
                self.api = FakeAPI(self.request)
                change(self.api)
                self.reject()

    def test_manifest_content_digest_mismatch_preserves_everything(self):
        manifest = next(a for a in self.api.assets if a['name'] == 'RELEASE-MANIFEST.json')
        manifest['digest'] = 'sha256:' + 'f' * 64
        self.reject('size/digest')

    def test_partially_or_fully_deleted_scope_is_idempotent(self):
        self.api.artifacts = self.api.artifacts[:2]
        self.assertEqual(len(self.execute()), 2)
        self.api = FakeAPI(self.request)
        self.api.artifacts = []
        self.assertEqual(self.execute(), [])
        self.assertEqual(self.api.deleted, [])

    def test_404_before_delete_is_idempotent(self):
        self.api.absent.add(self.api.artifacts[0]['id'])
        self.assertEqual(len(self.execute()), 8)
        self.assertNotIn(next(iter(self.api.absent)), self.api.deleted)

    def test_later_run_or_release_change_stops_remaining_deletes(self):
        for change in [lambda a: a.run.update(conclusion='failure'),
                       lambda a: a.release.update(id=999),
                       lambda a: a.assets[0].update(digest=None)]:
            with self.subTest(change=change):
                self.api = FakeAPI(self.request)
                self.api.after_delete = change
                with self.assertRaises(ValueError):
                    self.execute()
                self.assertEqual(len(self.api.deleted), 1)

    def test_wrapper_rejects_release_log_global_and_unapproved_deletions(self):
        scoped = legacy.ExactLegacyAPI(self.api, self.request)
        for path in [legacy.BASE + '/releases/assets/650823805', legacy.BASE + '/actions/artifacts/999',
                     legacy.BASE + '/actions/runs/39044915950/logs', legacy.BASE + '/actions/runs/39044915950',
                     legacy.BASE + '/actions/artifacts', '/repos/other/repo/actions/artifacts/12105920373']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                scoped.request(path, method='DELETE')
        self.assertEqual(self.api.calls, [])

    def test_wrapper_rejects_unscoped_pagination(self):
        scoped = legacy.ExactLegacyAPI(self.api, self.request)
        for path, key in [(legacy.BASE + '/actions/artifacts', 'artifacts'),
                          (legacy.BASE + '/actions/runs/999/artifacts', 'artifacts'),
                          (legacy.BASE + '/releases/999/assets', None)]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                scoped.pages(path, key)
        self.assertEqual(self.api.calls, [])

    def test_artifact_detail_response_must_match_requested_id(self):
        scoped = legacy.ExactLegacyAPI(self.api, self.request)
        wrong = self.api.artifacts[1]
        with patch.object(self.api, 'request', return_value=wrong), self.assertRaisesRegex(ValueError, 'response ID'):
            scoped.request(f'{legacy.BASE}/actions/artifacts/{self.api.artifacts[0]["id"]}')
        self.assertEqual(self.api.deleted, [])


class TrustedEntry(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'event.json'
        self.event = {'ref': 'refs/heads/main', 'after': 'a' * 40, 'deleted': False,
                      'repository': {'id': legacy.REPOSITORY_ID, 'full_name': legacy.REPOSITORY}}
        self.path.write_text(json.dumps(self.event))
        self.environment = {'GITHUB_REPOSITORY': legacy.REPOSITORY, 'GITHUB_EVENT_NAME': 'push',
                            'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_PATH': str(self.path),
                            'GITHUB_WORKFLOW_REF': f'{legacy.REPOSITORY}/.github/workflows/release-legacy-cleanup.yml@refs/heads/main',
                            'GITHUB_SHA': 'a' * 40, 'GH_TOKEN': 'synthetic-test-token'}

    def test_only_exact_main_push_context_is_accepted(self):
        with patch.dict(os.environ, self.environment):
            legacy.verify_event()
        for key, value in [('GITHUB_EVENT_NAME', 'workflow_dispatch'), ('GITHUB_EVENT_NAME', 'pull_request'),
                           ('GITHUB_REPOSITORY', 'other/repo'), ('GITHUB_REF', 'refs/heads/fork'),
                           ('GITHUB_WORKFLOW_REF', 'other'), ('GITHUB_SHA', 'b' * 40)]:
            with self.subTest(key=key), patch.dict(os.environ, {**self.environment, key: value}), self.assertRaises(ValueError):
                legacy.verify_event()

    def test_wrong_event_repo_branch_commit_and_deletion_are_rejected(self):
        for change in [lambda e: e.update(after='b' * 40), lambda e: e.update(deleted=True),
                       lambda e: e.update(ref='refs/heads/other'),
                       lambda e: e['repository'].update(id=999),
                       lambda e: e['repository'].update(full_name='other/repo')]:
            with self.subTest(change=change):
                event = copy.deepcopy(self.event)
                change(event)
                self.path.write_text(json.dumps(event))
                with patch.dict(os.environ, self.environment), self.assertRaises(ValueError):
                    legacy.verify_event()

    def test_entry_default_readonly_and_explicit_delete_scope(self):
        request = legacy.load_request()
        for args, expected_count in [([], 0), (['--delete'], 9)]:
            api = FakeAPI(request)
            with patch.dict(os.environ, self.environment), patch.object(legacy.cleanup, 'API', return_value=api):
                legacy.main(args)
            self.assertEqual(len(api.deleted), expected_count)

    def test_workflow_trigger_has_no_runtime_scope_input_and_job_only_permission(self):
        path = Path(__file__).parents[2] / 'workflows/release-legacy-cleanup.yml'
        text = path.read_text()
        self.assertIn("paths: ['.github/release/legacy-cleanup-request.json']", text)
        self.assertIn("branches: ['main']", text)
        self.assertNotIn('workflow_dispatch:', text)
        self.assertNotIn('workflow_call:', text)
        self.assertNotIn('actions: write', text.split('jobs:')[0])
        self.assertEqual(text.count('actions: write'), 1)
        self.assertIn('persist-credentials: false', text)
        self.assertIn('run: python3 .github/release/legacy_cleanup.py --delete', text)
        self.assertNotIn('continue-on-error:', text)
        self.assertNotIn('group: release-${{', text)
        self.assertLess(text.index('python3 -m unittest'), text.index('legacy_cleanup.py --delete'))


if __name__ == '__main__':
    unittest.main()
