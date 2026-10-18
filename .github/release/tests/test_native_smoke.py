import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

from test_publish import local_session_evidence, packaged_recovery_evidence, publish


class NativeSmoke(unittest.TestCase):
    def test_both_native_architectures_accept_core_proof_and_future_assertions(self):
        for arch in ('arm64', 'x64'):
            report = local_session_evidence(arch)
            report['phases'][0]['assertions'].append('extra meaningful regression coverage')
            publish.verify_local_session_smoke(report, arch)

    def test_scope_runtime_and_restart_fail_closed(self):
        mutations = [lambda r: r.update(passed=False), lambda r: r.update(passed=1),
                     lambda r: r.update(platform='linux'), lambda r: r.update(arch='arm64'),
                     lambda r: r.update(schema='synthetic-unit-fixture'), lambda r: r.update(error={}),
                     lambda r: r.update(phases=[]), lambda r: r['phases'].reverse(),
                     lambda r: r['phases'][1].update(pid=r['phases'][0]['pid']),
                     lambda r: r['phases'][1].update(origin='http://127.0.0.1:54321'),
                     lambda r: r['phases'][1].update(partition='persist:old'),
                     lambda r: r['phases'][0].update(electron='44.0.0'),
                     lambda r: r['phases'][0].update(arch='arm64'),
                     lambda r: r['phases'][0].update(passed=False),
                     lambda r: r['phases'][0].update(stage='waiting'),
                     lambda r: r['phases'][0].update(pid=True),
                     lambda r: r['phases'][0].update(error={}),
                     lambda r: r['phases'][0].update(sessions=[]),
                     lambda r: r['phases'][0]['sessions'][0].update(persistent=True),
                     lambda r: r['phases'][0]['sessions'][0].update(storagePathNull=False)]
        for key in ('packagedAppTested', 'keychainAccessInstrumented', 'realUserProfileAccessed',
                    'actualProcessRestart', 'sameOriginAcrossRestart'):
            mutations.append(lambda r, key=key: r.pop(key))
            mutations.append(lambda r, key=key: r.update({key: not r[key]}))
        for key in ('testCookieEncryption', 'onlyCookieEncryptionFuseChanged',
                    'sourceFuseWireUnchanged', 'macTestCopyAdHocReset'):
            mutations.append(lambda r, key=key: r['runtime'].update({key: False}))
        for mutation in mutations:
            report = local_session_evidence('x64')
            mutation(report)
            with self.subTest(report=report), self.assertRaises(ValueError):
                publish.verify_local_session_smoke(report, 'x64')

    def test_every_core_safety_assertion_is_required_in_each_phase(self):
        pristine = local_session_evidence('arm64')
        for index, phase in enumerate(pristine['phases']):
            for assertion in phase['assertions']:
                report = copy.deepcopy(pristine)
                report['phases'][index]['assertions'].remove(assertion)
                with self.subTest(phase=phase['phase'], missing=assertion), self.assertRaisesRegex(ValueError, 'safety assertions'):
                    publish.verify_local_session_smoke(report, 'arm64')

    def test_binding_proof_is_native_and_tied_to_final_payload(self):
        package = {'asarSha256': 'a' * 64, 'executableSha256': 'b' * 64,
                   'finalRecoveryBinding': {'sha256': 'f' * 64},
                   'macArchitecture': {'nativeNodeModules': [f'Contents/Resources/app.asar.unpacked/node_modules/classic-level/prebuilds/darwin-{arch}/classic-level.node' for arch in ('x64', 'arm64')]}}
        for arch in ('arm64', 'x64'):
            publish.verify_packaged_recovery_smoke(packaged_recovery_evidence(arch, package), package, arch)
        pristine = packaged_recovery_evidence('x64', package)
        for key, value in pristine.items():
            for replacement in (None, not value if type(value) is bool else 'wrong'):
                report = dict(pristine, **{key: replacement})
                with self.subTest(key=key, replacement=replacement), self.assertRaises(ValueError):
                    publish.verify_packaged_recovery_smoke(report, package, 'x64')
        with self.assertRaisesRegex(ValueError, 'independent architecture'):
            publish.verify_packaged_recovery_smoke(pristine, dict(package, macArchitecture={'nativeNodeModules': []}), 'x64')
        with self.assertRaisesRegex(ValueError, 'packaged payload'):
            publish.verify_packaged_recovery_smoke(dict(pristine, bindingSha256='e' * 64), package, 'x64')

    def test_workflow_runs_both_smokes_before_asset_upload_and_publication(self):
        workflow = (Path(__file__).parents[2] / 'workflows/release.yml').read_text()
        mac = workflow.split('  package-macos:', 1)[1].split('  package-windows:', 1)[0]
        self.assertIn('os: macos-15\n', mac)
        self.assertIn('os: macos-15-intel\n', mac)
        positions = [mac.index(value) for value in (
            'npm ci\n', 'node scripts/smoke-local-session.cjs --report',
            'node scripts/package.cjs mac', 'node scripts/verify-desktop-archives.cjs mac',
            'node scripts/smoke-packaged-recovery.cjs --arch',
            'python3 ../.github/release/attach-native-smoke.py',
            'cp dist/verified-mac-', 'actions/upload-artifact@')]
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn('continue-on-error', mac)
        self.assertIn("needs.package-macos.result == 'success'", workflow)
        self.assertNotIn('local-session-${{ matrix.arch }}.json release/', mac)

    def test_attachment_validates_before_atomic_update_without_adding_assets(self):
        # Load only the local helper. No GitHub calls are involved.
        sys.modules['publish'] = publish
        spec = importlib.util.spec_from_file_location('attach_native_smoke', Path(__file__).parents[1] / 'attach-native-smoke.py')
        attach = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(attach)
        arch = 'arm64'
        package = {'platform': 'mac', 'arch': arch, 'version': '1.2.1', 'backendVersion': '1.2.1',
                   'executableSha256': 'b' * 64, 'asarSha256': 'a' * 64,
                   'finalRecoveryBinding': {'entry': f'node_modules/classic-level/prebuilds/darwin-{arch}/classic-level.node',
                       'sha256': 'f' * 64, 'bytes': 1024, 'unpacked': True, 'finalDiskBytes': True},
                   'backendSourceSnapshotSha256': 'c' * 64, 'fusesVerified': publish.FUSES,
                   'nativeHost': {'platform': 'darwin', 'arch': arch, 'machine': arch, 'runnerArch': 'ARM64', 'translated': False},
                   'macArchitecture': {'targetArch': arch, 'allMachOMatchTarget': True,
                     'machOFiles': [{'path': 'Contents/MacOS/青单', 'format': 'mach-o64', 'architectures': [arch]}], 'nativeNodeModules': []}}
        binding_path = f'Contents/Resources/app.asar.unpacked/node_modules/classic-level/prebuilds/darwin-{arch}/classic-level.node'
        package['macArchitecture']['nativeNodeModules'].append(binding_path)
        package['macArchitecture']['machOFiles'].append({'path': binding_path, 'format': 'mach-o64', 'architectures': [arch]})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report, local, binding = (root / name for name in ('verified.json', 'local.json', 'binding.json'))
            report.write_text(json.dumps(package))
            local.write_text(json.dumps(local_session_evidence(arch)))
            binding.write_text(json.dumps(packaged_recovery_evidence(arch, package)))
            args = ['--arch', arch, '--package', str(report), '--local-session', str(local), '--native-binding', str(binding)]
            before = report.read_bytes()
            invalid = local_session_evidence(arch)
            invalid['passed'] = False
            local.write_text(json.dumps(invalid))
            with self.assertRaises(ValueError):
                attach.main(args)
            self.assertEqual(report.read_bytes(), before)
            local.write_text(json.dumps(local_session_evidence(arch)))
            attach.main(args)
            merged = json.loads(report.read_text())
            self.assertEqual({key: merged[key] for key in package}, package)
            self.assertEqual(merged['localSessionSmoke'], local_session_evidence(arch))
            self.assertTrue(merged['packagedRecoverySmoke']['passed'])
            self.assertEqual({item.name for item in root.iterdir()}, {'verified.json', 'local.json', 'binding.json'})


if __name__ == '__main__':
    unittest.main()
