"""Packaging metadata tests use only fresh synthetic files, never user data."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'prepare-runtime.py'

class PrepareRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='qingdan-runtime-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.output = self.root / 'output'
        files = {
            'package.json': json.dumps({'name': 'qingdan-fixture', 'version': '1.1.0'}),
            'package-lock.json': '{}', 'README.md': 'Fixture', 'AUTH.md': 'Fixture',
            'VERIFICATION.md': 'Fixture', 'dist/server/main.mjs': '// fixture',
            'docs/THIRD-PARTY-NOTICES.md': 'Fixture source acquisition: https://registry.npmjs.org/ical.js/-/ical.js-2.2.1.tgz\n[License](licenses/ical.js-MPL-2.0.txt)\n',
            'docs/licenses/ical.js-MPL-2.0.txt': 'Mozilla Public License Version 2.0\nSynthetic retained license fixture.\n',
            'dist/server/users.mjs': '// fixture', 'dist/client/index.html': '<main>Fixture</main>',
            'drizzle/0000_fixture.sql': '-- fixture',
        }
        for name, content in files.items():
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        (self.source / 'tests').mkdir()
        self.write_evidence()

    def write_evidence(self, omit=None):
        checks = {'test': 1, 'test:ui': 1, 'test:server': 1, 'typecheck': True, 'build': True}
        if omit: checks.pop(omit)
        hashes = {path.relative_to(self.source).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in self.source.rglob('*') if path.is_file() and 'dist' not in path.relative_to(self.source).parts and path.relative_to(self.source).as_posix() != 'tests/standalone-evidence.json'}
        (self.source / 'tests/standalone-evidence.json').write_text(json.dumps({'checks': checks, 'sha256': hashes, 'artifact_sha256': {path.relative_to(self.source).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in (self.source / 'dist').rglob('*') if path.is_file()}}))

    def run_prepare(self):
        return subprocess.run([sys.executable, str(SCRIPT), str(self.source), str(self.output)], capture_output=True, text=True)

    def test_preserves_release_version_and_verified_snapshot(self):
        result = self.run_prepare()
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((self.output / 'RUNTIME-MANIFEST.json').read_text())
        self.assertEqual(manifest['version'], '1.1.0')
        self.assertRegex(manifest['source_snapshot_sha256'], '^[a-f0-9]{64}$')
        self.assertNotIn('source_commit', manifest)
        self.assertTrue(all('\\' not in name for name in manifest['files_sha256']))
        self.assertIn('dist/server/main.mjs', manifest['files_sha256'])
        for name, digest in manifest['files_sha256'].items():
            self.assertEqual(hashlib.sha256((self.output / name).read_bytes()).hexdigest(), digest)

    def test_changed_source_fails_before_output_exists(self):
        (self.source / 'README.md').write_text('Changed after checks')
        self.assertNotEqual(self.run_prepare().returncode, 0)
        self.assertFalse(self.output.exists())

    def test_dependency_source_notice_and_license_are_copied_and_manifested(self):
        result = self.run_prepare()
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((self.output / 'RUNTIME-MANIFEST.json').read_text())
        for name in ['docs/THIRD-PARTY-NOTICES.md', 'docs/licenses/ical.js-MPL-2.0.txt']:
            self.assertEqual((self.output / name).read_bytes(), (self.source / name).read_bytes())
            self.assertEqual(manifest['files_sha256'][name], hashlib.sha256((self.source / name).read_bytes()).hexdigest())
        self.assertIn('https://registry.npmjs.org/ical.js/-/ical.js-2.2.1.tgz',
                      (self.output / 'docs/THIRD-PARTY-NOTICES.md').read_text())

    def test_missing_dependency_notice_or_license_cannot_be_omitted_from_a_checked_runtime(self):
        for name in ['docs/THIRD-PARTY-NOTICES.md', 'docs/licenses/ical.js-MPL-2.0.txt']:
            with self.subTest(name=name):
                path = self.source / name
                original = path.read_bytes()
                path.unlink()
                self.write_evidence()
                result = self.run_prepare()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Missing or non-regular input: ' + name, result.stderr)
                self.assertFalse(self.output.exists())
                path.write_bytes(original)
                self.write_evidence()

    def test_notice_changed_after_checks_is_rejected(self):
        (self.source / 'docs/THIRD-PARTY-NOTICES.md').write_text('Changed source information after checks')
        self.assertNotEqual(self.run_prepare().returncode, 0)
        self.assertFalse(self.output.exists())

    def test_missing_required_check_is_rejected(self):
        self.write_evidence(omit='test:server')
        self.assertNotEqual(self.run_prepare().returncode, 0)
        self.assertFalse(self.output.exists())

    def test_changed_build_artifact_is_rejected(self):
        (self.source / 'dist/client/index.html').write_text('Changed after build')
        self.assertNotEqual(self.run_prepare().returncode, 0)
        self.assertFalse(self.output.exists())

    def test_added_unchecked_migration_is_rejected(self):
        (self.source / 'drizzle/9999_added_after_checks.sql').write_text('-- not checked')
        self.assertNotEqual(self.run_prepare().returncode, 0)
        self.assertFalse(self.output.exists())

    def test_checks_cannot_be_bypassed_by_optimized_python(self):
        self.write_evidence(omit='test:server')
        result = subprocess.run([sys.executable, '-O', str(SCRIPT), str(self.source), str(self.output)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.output.exists())

    def test_existing_output_is_never_overwritten(self):
        self.output.mkdir()
        marker = self.output / 'marker.txt'
        marker.write_text('retain')
        self.assertNotEqual(self.run_prepare().returncode, 0)
        self.assertEqual(marker.read_text(), 'retain')

    def test_ambiguous_version_is_rejected(self):
        (self.source / 'package.json').write_text(json.dumps({'version': 'latest'}))
        self.write_evidence()
        self.assertNotEqual(self.run_prepare().returncode, 0)
        self.assertFalse(self.output.exists())

if __name__ == '__main__':
    unittest.main()
