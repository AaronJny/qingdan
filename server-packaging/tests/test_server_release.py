"""Offline, synthetic packaging regressions. Fixtures never establish official Node provenance."""
import importlib.util
import io
import json
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock
import zipfile

PACKAGING = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGING))
import release_contract as contract


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, PACKAGING / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


assembler = load('assembler', 'assemble.py')
zipper = load('zipper', 'zip-release.py')
verifier = load('verifier', 'verify-release.py')


class ServerReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='青单 packaging fixture ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / 'app'
        self.nodes = self.root / 'archives'
        self.server = self.root / 'server'
        self.zip = self.root / 'release.zip'
        self.app.mkdir()
        self.nodes.mkdir()
        self.snapshot = 'a' * 64
        self.write_app()
        # Patch fixed values only in this test process. No product CLI allows synthetic pins.
        self.archive_hashes, self.binary_hashes = {}, {}
        self.license = b'Synthetic test license, not official Node bytes.\n'
        for arch in ('linux-x64', 'darwin-arm64'):
            node = (b'\x7fELF\x02\x01\x00\x00' if arch == 'linux-x64' else b'\xcf\xfa\xed\xfe\x00\x00\x00\x00') + b'fixture-' + arch.encode()
            self.binary_hashes[arch] = __import__('hashlib').sha256(node).hexdigest()
            name = f'node-v24.19.0-{arch}.tar.xz'
            with tarfile.open(self.nodes / name, 'w:xz') as archive:
                for relative, content in (('bin/node', node), ('LICENSE', self.license)):
                    info = tarfile.TarInfo(name[:-7] + '/' + relative)
                    info.size = len(content)
                    archive.addfile(info, io.BytesIO(content))
            self.archive_hashes[arch] = contract.digest(self.nodes / name)
        (self.nodes / 'SHASUMS256.txt').write_text(''.join(f'{value}  node-v24.19.0-{arch}.tar.xz\n' for arch, value in self.archive_hashes.items()))
        self.addCleanup(mock.patch.stopall)
        mock.patch.dict(contract.ARCHIVE_SHA256, self.archive_hashes).start()
        mock.patch.dict(contract.ARCHIVE_BYTES, {arch: (self.nodes / f'node-v24.19.0-{arch}.tar.xz').stat().st_size for arch in self.archive_hashes}).start()
        mock.patch.dict(contract.BINARY_SHA256, self.binary_hashes).start()
        license_hash = __import__('hashlib').sha256(self.license).hexdigest()
        for module in (contract, assembler, verifier):
            mock.patch.object(module, 'LICENSE_SHA256', license_hash).start()

    def put(self, name, content):
        path = self.app / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')

    def write_app(self):
        package = {'name': 'qingdan-standalone', 'version': '1.1.0', 'type': 'module',
                   'dependencies': {'@fixture/direct': '1.0.0'}}
        self.put('package.json', json.dumps(package))
        self.lock = {'name': 'qingdan-standalone', 'version': '1.1.0', 'lockfileVersion': 3,
                     'packages': {'': package}}
        records = []
        for name in ('@fixture/direct', '@fixture/transitive'):
            location = 'node_modules/' + name
            entry = {'version': '1.0.0', 'resolved': 'https://registry.npmjs.org/' + name + '/-/fixture-1.0.0.tgz',
                     'integrity': 'sha512-' + 'A' * 86 + '==', 'license': 'MIT'}
            self.lock['packages'][location] = entry
            self.put(location + '/package.json', json.dumps({'name': name, 'version': '1.0.0'}))
            self.put(location + '/index.js', '// synthetic dependency')
            self.put(location + '/LICENSE', 'Synthetic MIT fixture')
            records.append({'name': name, 'location': location, **entry,
                            'files_sha256': contract.files(self.app / location)})
        self.put('package-lock.json', json.dumps(self.lock))
        self.put('dependency-manifest.json', json.dumps({'source_snapshot_sha256': self.snapshot,
                 'application_lock_sha256': 'b' * 64, 'external_imports': ['@fixture/direct'], 'packages': records}))
        self.put('dist/server/main.mjs', '// synthetic main')
        self.put('dist/server/users.mjs', '// synthetic users')
        self.put('dist/server/calendar-worker.mjs', '// synthetic calendar worker; structural fixture only')
        self.put('dist/client/index.html', '<html><body>Fixture</body></html>')
        self.put('drizzle/0000_fixture.sql', '-- synthetic migration')
        self.put('README.md', 'Fixture documentation')
        self.put('LICENSE', 'Synthetic project license fixture.\n')
        self.put('docs/LICENSING.md', 'Synthetic project source-delivery guidance.\n')
        self.put('docs/THIRD-PARTY-NOTICES.md', 'Fixture source: https://registry.npmjs.org/ical.js/-/ical.js-2.2.1.tgz\n[License](licenses/ical.js-MPL-2.0.txt)\n')
        self.put('docs/licenses/ical.js-MPL-2.0.txt', 'Mozilla Public License Version 2.0\nSynthetic retained license fixture.\n')
        self.refresh_manifest()

    def refresh_manifest(self):
        inventory = {name: value for name, value in contract.files(self.app).items()
                     if not name.startswith('node_modules/') and name != 'RUNTIME-MANIFEST.json'}
        self.put('RUNTIME-MANIFEST.json', json.dumps({'product': 'qingdan-standalone', 'version': '1.1.0',
                 'source_snapshot_sha256': self.snapshot, 'checks': {key: True for key in contract.CHECKS},
                 'external_imports': ['@fixture/direct'], 'files_sha256': inventory}))

    def build(self):
        return assembler.assemble(self.app, self.server, nodes=self.nodes)

    def make_zip(self):
        self.build()
        return zipper.create_zip(self.server, self.zip)

    def test_complete_fixture_assembly_zip_independent_extraction(self):
        result = self.make_zip()
        self.assertEqual(result['source_snapshot_sha256'], self.snapshot)
        self.assertEqual(result['version'], '1.1.0')
        self.assertNotIn('source_commit', result)
        with zipfile.ZipFile(self.zip) as archive:
            for entry in contract.ENTRYPOINTS:
                self.assertTrue(archive.getinfo('qingdan-server/' + entry).external_attr >> 16 & 0o111)
        extracted = verifier.extract_archive(self.zip, self.root / 'independent 中文 path')
        self.assertEqual(verifier.verify_structure(extracted)['application_source_snapshot_sha256'], self.snapshot)
        for name in ['LICENSE', 'docs/LICENSING.md', 'docs/THIRD-PARTY-NOTICES.md', 'docs/licenses/ical.js-MPL-2.0.txt']:
            self.assertEqual((extracted / 'app' / name).read_bytes(), (self.app / name).read_bytes())

    def test_zip_cli_succeeds_with_snapshot_and_optimized_python(self):
        self.build()
        result = subprocess.run([sys.executable, '-O', str(PACKAGING / 'zip-release.py'), str(self.server), str(self.zip)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['source_snapshot_sha256'], self.snapshot)

    def test_tampered_app_file_fails_before_output_exists(self):
        self.put('dist/server/main.mjs', '// changed after check')
        with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
            self.build()
        self.assertFalse(self.server.exists())

    def test_missing_calendar_worker_rejected_even_with_updated_inventory(self):
        (self.app / 'dist/server/calendar-worker.mjs').unlink()
        self.refresh_manifest()
        with self.assertRaisesRegex(ValueError, 'required verified application file'):
            self.build()
        self.assertFalse(self.server.exists())

    def test_unlisted_app_file_rejected(self):
        self.put('dist/client/unverified.js', 'unverified')
        with self.assertRaisesRegex(ValueError, 'inventory differs'):
            self.build()
        self.assertFalse(self.server.exists())

    def test_transitive_dependency_tamper_rejected(self):
        self.put('node_modules/@fixture/transitive/index.js', '// altered dependency')
        with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
            self.build()
        self.assertFalse(self.server.exists())

    def test_transitive_version_not_only_direct_version_is_checked(self):
        path = self.app / 'node_modules/@fixture/transitive/package.json'
        package = json.loads(path.read_text())
        package['version'] = '9.9.9'
        path.write_text(json.dumps(package))
        with self.assertRaisesRegex(ValueError, 'transitive dependency differs'):
            self.build()
        self.assertFalse(self.server.exists())

    def test_dependency_manifest_stale_snapshot_rejected(self):
        path = self.app / 'dependency-manifest.json'
        manifest = json.loads(path.read_text())
        manifest['source_snapshot_sha256'] = 'c' * 64
        path.write_text(json.dumps(manifest))
        self.refresh_manifest()
        with self.assertRaisesRegex(ValueError, 'Dependency source snapshot'):
            self.build()

    def test_unlisted_dependency_package_rejected(self):
        self.put('node_modules/unlisted/index.js', '// unexpected')
        with self.assertRaisesRegex(ValueError, 'file tree differs'):
            self.build()

    def nest_transitive(self):
        import shutil
        location = 'node_modules/@fixture/direct/node_modules/@fixture/transitive'
        nested = self.app / location
        nested.parent.mkdir(parents=True)
        shutil.move(str(self.app / 'node_modules/@fixture/transitive'), nested)
        self.lock['packages'][location] = self.lock['packages'].pop('node_modules/@fixture/transitive')
        self.lock['packages']['node_modules/@fixture/direct']['dependencies'] = {'@fixture/transitive': '1.0.0'}
        self.put('package-lock.json', json.dumps(self.lock))
        path = self.app / 'dependency-manifest.json'
        dependency = json.loads(path.read_text())
        for record in dependency['packages']:
            if record['name'] == '@fixture/transitive':
                record['location'] = location
            elif record['name'] == '@fixture/direct':
                record['files_sha256'] = {name: value for name, value in contract.files(self.app / record['location']).items()
                                          if not name.startswith('node_modules/')}
        path.write_text(json.dumps(dependency))
        self.refresh_manifest()

    def test_user_guide_omits_internal_snapshot_but_manifests_stay_bound(self):
        self.make_zip()
        extracted = verifier.extract_archive(self.zip, self.root / 'reader guide extraction')
        manifest = verifier.verify_structure(extracted)
        snapshot = manifest['application_source_snapshot_sha256']
        self.assertNotIn(snapshot, (extracted / '先读我.txt').read_text())
        self.assertIn('SERVER-MANIFEST.json', (extracted / '先读我.txt').read_text())
        runtime = json.loads((extracted / 'app/RUNTIME-MANIFEST.json').read_text())
        self.assertEqual(snapshot, runtime['source_snapshot_sha256'])

    def test_nested_dependency_closure_and_independent_extraction(self):
        self.nest_transitive()
        self.make_zip()
        extracted = verifier.extract_archive(self.zip, self.root / 'nested extraction')
        self.assertEqual(verifier.verify_structure(extracted)['version'], '1.1.0')

    def test_nested_transitive_dependency_tamper_rejected(self):
        self.nest_transitive()
        self.put('node_modules/@fixture/direct/node_modules/@fixture/transitive/index.js', '// altered nested dependency')
        with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
            self.build()
        self.assertFalse(self.server.exists())

    def test_unverified_runtime_archive_rejected_and_staging_cleaned(self):
        (self.nodes / 'node-v24.19.0-darwin-arm64.tar.xz').write_bytes(b'not pinned')
        with self.assertRaisesRegex(ValueError, 'archive mismatch'):
            self.build()
        self.assertFalse(self.server.exists())
        self.assertFalse(list(self.root.glob('.qingdan-server-stage-*')))

    def test_invalid_binary_even_matching_archive_pin_rejected(self):
        contract.BINARY_SHA256['darwin-arm64'] = 'd' * 64
        with self.assertRaisesRegex(ValueError, 'binary mismatch'):
            self.build()
        self.assertFalse(self.server.exists())
        self.assertFalse(list(self.root.glob('.qingdan-server-stage-*')))

    def test_checksum_manifest_cannot_override_fixed_pin(self):
        (self.nodes / 'SHASUMS256.txt').write_text('e' * 64 + '  node-v24.19.0-linux-x64.tar.xz\n')
        with self.assertRaisesRegex(ValueError, 'Pinned official archive checksum mismatch'):
            self.build()
        self.assertFalse(self.server.exists())

    def test_existing_output_never_replaced(self):
        self.server.mkdir()
        marker = self.server / 'retain.txt'
        marker.write_text('keep')
        with self.assertRaisesRegex(ValueError, 'fresh directory'):
            self.build()
        self.assertEqual(marker.read_text(), 'keep')

    def test_missing_required_check_rejected_even_under_optimized_python(self):
        path = self.app / 'RUNTIME-MANIFEST.json'
        manifest = json.loads(path.read_text())
        manifest['checks']['test:server'] = False
        path.write_text(json.dumps(manifest))
        result = subprocess.run([sys.executable, '-O', str(PACKAGING / 'assemble.py'), '--app', str(self.app),
                                '--nodes', str(self.nodes), '--output', str(self.server)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Complete source-check', result.stderr)
        self.assertFalse(self.server.exists())

    def test_user_data_and_symlink_inputs_rejected(self):
        data = self.app / 'data'
        data.mkdir()
        with self.assertRaisesRegex(ValueError, 'user data'):
            self.build()
        data.rmdir()
        (self.app / 'escape').symlink_to(self.root)
        with self.assertRaisesRegex(ValueError, 'Unsafe symlink'):
            self.build()
        self.assertFalse(self.server.exists())

    def test_reuse_verified_runtime_and_reject_modified_provenance(self):
        self.build()
        prior = self.server / 'runtime'
        second = self.root / 'second-server'
        assembler.assemble(self.app, second, prior=prior)
        self.assertEqual(verifier.verify_structure(second)['version'], '1.1.0')
        records_path = prior / 'NODE-RUNTIMES.json'
        records = json.loads(records_path.read_text())
        records[0]['node_bytes'] += 1
        records_path.write_text(json.dumps(records))
        third = self.root / 'third-server'
        with self.assertRaisesRegex(ValueError, 'byte size mismatch'):
            assembler.assemble(self.app, third, prior=prior)
        self.assertFalse(third.exists())

    def test_reused_runtime_cannot_falsify_official_archive_byte_size(self):
        self.build()
        prior = self.server / 'runtime'
        path = prior / 'NODE-RUNTIMES.json'
        records = json.loads(path.read_text())
        records[0]['bytes'] = 1
        path.write_text(json.dumps(records))
        with self.assertRaisesRegex(ValueError, 'archive byte size mismatch'):
            assembler.assemble(self.app, self.root / 'second-server', prior=prior)
        self.assertFalse((self.root / 'second-server').exists())

    def test_zip_inventory_tamper_rejected_before_zip_exists(self):
        self.build()
        (self.server / 'start.sh').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
            zipper.create_zip(self.server, self.zip)
        self.assertFalse(self.zip.exists())

    def test_zip_unlisted_file_rejected(self):
        self.build()
        (self.server / 'unlisted.txt').write_text('extra')
        with self.assertRaisesRegex(ValueError, 'inventory differs'):
            zipper.create_zip(self.server, self.zip)
        self.assertFalse(self.zip.exists())

    def test_zip_failure_removes_partial_output(self):
        self.build()
        with mock.patch.object(zipfile.ZipFile, 'write', side_effect=OSError('synthetic write failure')):
            with self.assertRaisesRegex(OSError, 'synthetic write failure'):
                zipper.create_zip(self.server, self.zip)
        self.assertFalse(self.zip.exists())

    def test_zip_existing_output_is_never_truncated(self):
        self.build()
        self.zip.write_text('prior artifact')
        with self.assertRaisesRegex(ValueError, 'overwrite'):
            zipper.create_zip(self.server, self.zip)
        self.assertEqual(self.zip.read_text(), 'prior artifact')

    def test_zip_output_within_input_rejected(self):
        self.build()
        with self.assertRaisesRegex(ValueError, 'outside'):
            zipper.create_zip(self.server, self.server / 'bad.zip')

    def test_extracted_permission_loss_rejected(self):
        self.make_zip()
        extracted = verifier.extract_archive(self.zip, self.root / 'extracted')
        (extracted / 'start.sh').chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'executable permission'):
            verifier.verify_structure(extracted)

    def test_extracted_runtime_provenance_independent_of_server_inventory(self):
        self.build()
        records_path = self.server / 'runtime/NODE-RUNTIMES.json'
        records = json.loads(records_path.read_text())
        records[0]['url'] = 'https://example.test/fake-node.tar.xz'
        records_path.write_text(json.dumps(records))
        manifest_path = self.server / 'SERVER-MANIFEST.json'
        manifest = json.loads(manifest_path.read_text())
        manifest['files_sha256']['runtime/NODE-RUNTIMES.json'] = contract.digest(records_path)
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'archive provenance'):
            verifier.verify_structure(self.server)

    def test_unsafe_manifest_paths_rejected(self):
        self.build()
        path = self.server / 'SERVER-MANIFEST.json'
        manifest = json.loads(path.read_text())
        manifest['files_sha256']['../outside'] = 'f' * 64
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'Unsafe manifest path'):
            zipper.create_zip(self.server, self.zip)
        self.assertFalse(self.zip.exists())

    def test_duplicate_json_key_rejected(self):
        path = self.app / 'RUNTIME-MANIFEST.json'
        path.write_text('{"version":"1.1.0","version":"2.0.0"}')
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON key'):
            self.build()

    def malicious_zip(self, names):
        with zipfile.ZipFile(self.zip, 'w') as archive:
            for name, mode in names:
                entry = zipfile.ZipInfo(name)
                entry.create_system = 3
                entry.external_attr = mode << 16
                archive.writestr(entry, b'fixture')

    def test_zip_traversal_rejected_before_extraction(self):
        self.malicious_zip([('qingdan-server/../outside', stat.S_IFREG | 0o644)])
        with self.assertRaisesRegex(ValueError, 'Unsafe manifest path'):
            verifier.extract_archive(self.zip, self.root / 'extract')
        self.assertFalse((self.root / 'extract').exists())

    def test_zip_symlink_rejected_before_extraction(self):
        self.malicious_zip([('qingdan-server/link', stat.S_IFLNK | 0o777)])
        with self.assertRaisesRegex(ValueError, 'regular file'):
            verifier.extract_archive(self.zip, self.root / 'extract')
        self.assertFalse((self.root / 'extract').exists())

    def test_duplicate_zip_entries_rejected_before_extraction(self):
        with self.assertWarns(UserWarning):
            self.malicious_zip([('qingdan-server/file', stat.S_IFREG | 0o644)] * 2)
        with self.assertRaisesRegex(ValueError, 'Duplicate ZIP entry'):
            verifier.extract_archive(self.zip, self.root / 'extract')
        self.assertFalse((self.root / 'extract').exists())

    def test_smoke_environment_does_not_inherit_node_injection_or_secrets(self):
        import os
        work = self.root / 'hermetic-smoke'
        work.mkdir()
        with mock.patch.dict(os.environ, {'NODE_OPTIONS': '--require=untrusted.cjs', 'NODE_PATH': '/untrusted',
                                        'HTTPS_PROXY': 'https://proxy.example.test', 'SECRET_AUTH_TOKEN': 'fixture-token',
                                        'APP_MODE': 'accounts', 'QINGDAN_DATA_DIR': '/untrusted-data'}):
            smoke = verifier.Smoke(self.app, work, '1.1.0')
            try:
                for name in ('NODE_OPTIONS', 'NODE_PATH', 'HTTPS_PROXY', 'SECRET_AUTH_TOKEN', 'APP_MODE', 'QINGDAN_DATA_DIR'):
                    self.assertNotIn(name, smoke.env)
                self.assertEqual(smoke.env['PATH'], os.defpath)
                self.assertEqual(smoke.env['HOME'], str(smoke.home))
            finally:
                smoke.cleanup()

    def test_verifier_failure_reports_no_false_success(self):
        self.malicious_zip([('wrong-root/file', stat.S_IFREG | 0o644)])
        report = self.root / 'verification.json'
        result = subprocess.run([sys.executable, str(PACKAGING / 'verify-release.py'), '--zip', str(self.zip), '--report', str(report)],
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        evidence = json.loads(report.read_text())
        self.assertEqual(evidence['status'], 'failed')
        self.assertNotIn('structural', evidence)
        self.assertNotIn('smoke', evidence)


if __name__ == '__main__':
    unittest.main()
