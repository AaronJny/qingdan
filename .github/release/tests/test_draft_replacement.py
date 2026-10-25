"""Explicit unpublished draft replacement never relaxes normal release guards."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('publish_replacement', Path(__file__).parents[1] / 'publish.py')
publish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)

class DraftReplacementTests(unittest.TestCase):
    def setUp(self):
        self.source = 'b' * 40
        self.assets = [{'id': 12, 'name': 'RELEASE-MANIFEST.json', 'size': 12, 'digest': 'sha256:' + 'c' * 64}]
        self.release = {'id': 123, 'draft': True, 'tag_name': 'v1.3.9', 'target_commitish': 'a' * 40, 'assets': self.assets}
        self.request = {'releaseId': 123, 'oldSourceCommit': 'a' * 40, 'newSourceCommit': self.source, 'newSourceRunId': 456, 'assets': copy.deepcopy(self.assets)}
        self.files = [Path('RELEASE-MANIFEST.json'), Path('app.apk')]

    def plan(self, **changes):
        values = dict(release=self.release, authorization=self.request, files=self.files, commit=self.source,
                      run_id='456', tag='v1.3.9', complete=True, tag_exists=False)
        values.update(changes)
        return publish.superseded_draft_plan(**values)

    def test_exact_unpublished_snapshot_can_replace_generated_assets(self):
        self.assertEqual(self.plan(), ([], ['RELEASE-MANIFEST.json'], ['app.apk']))

    def test_release_identity_and_published_state_fail_closed(self):
        for key, value in [('id', 124), ('draft', False), ('tag_name', 'v1.4.0'), ('target_commitish', 'd' * 40)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.plan(release={**self.release, key: value})

    def test_request_and_new_build_identity_must_be_explicit(self):
        for key, value in [('releaseId', 124), ('oldSourceCommit', 'd' * 40), ('newSourceCommit', 'd' * 40), ('newSourceRunId', 457), ('assets', [])]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.plan(authorization={**self.request, key: value})
        with self.assertRaises(ValueError): self.plan(authorization={})

    def test_every_asset_field_and_inventory_must_match(self):
        for key, value in [('id', 13), ('name', 'other.json'), ('size', 13), ('digest', 'sha256:' + 'd' * 64)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.plan(release={**self.release, 'assets': [{**self.assets[0], key: value}]})
        with self.assertRaises(ValueError): self.plan(release={**self.release, 'assets': self.assets * 2})

    def test_no_tag_and_all_platforms_required(self):
        with self.assertRaises(ValueError): self.plan(tag_exists=True)
        with self.assertRaises(ValueError): self.plan(complete=False)
        with self.assertRaises(ValueError): self.plan(files=[Path('app.apk')])

    def test_bad_digest_or_unknown_asset_rejected_even_if_snapshot_matches(self):
        for key, value in [('digest', 'unverified'), ('size', 0), ('name', 'private.txt')]:
            assets = [{**self.assets[0], key: value}]
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.plan(release={**self.release, 'assets': assets}, authorization={**self.request, 'assets': assets})
