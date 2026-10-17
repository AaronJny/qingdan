import importlib.util
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('qingdan_publish', Path(__file__).parents[1] / 'publish.py')
publish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)

class Assets(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        for name in ['Qingdan-1.1.1-win-x64.zip','qingdan-server-v1.1.1.zip']:
            self.zip(name)
        (self.root/'Qingdan-1.1.1-mac-arm64.dmg').write_bytes(b'\0'*1100+b'koly'+b'\0'*508)
        (self.root/'Qingdan-1.1.1-linux-x64.AppImage').write_bytes(b'\x7fELF'+b'\0'*4+b'AI\x02'+b'\0'*1500)
        self.zip('Qingdan-1.1.1-mac-arm64.zip')
        self.json('qingdan-server-v1.1.1.verification.json',{'version':'1.1.1','status':'passed','smoke':{'status':'passed'}})
        for platform,arch in [('mac','arm64'),('win','x64'),('linux','x64')]:
            self.json(f'verified-{platform}-{arch}.json',{'version':'1.1.1','backendVersion':'1.1.1','fusesVerified':{'RunAsNode':False}})
        for name in publish.candidate_names('1.1.1', '0.1.1', False):
            if not (self.root / name).exists():
                (self.root / name).write_text('{}' if name.endswith('.json') else 'test evidence')
        self.mac_evidence()
    def mac_evidence(self):
        names = [f'Qingdan-1.1.1-mac-arm64.{ext}' for ext in ('dmg', 'zip')]
        self.json('verified-mac-arm64-archives.json', {'artifacts': [
            {'filename': name, 'bytes': (self.root/name).stat().st_size,
             'sha256': publish.digest(self.root/name)} for name in names], 'appName': '青单.app'})
        (self.root/'SHA256SUMS-macos.txt').write_text(''.join(
            f'{publish.digest(self.root/name)}  {name}\n' for name in names))
    def android(self):
        self.zip('Qingdan-0.1.1-android.apk')
        apk = self.root/'Qingdan-0.1.1-android.apk'
        self.json(apk.name+'.verification.json',{'installable_candidate':True,'signature':{'verified':True,'v2_verified':True},'manifest_identity_verified':True,'zip_16k_alignment_verified':True,'apk':apk.name,'bytes':apk.stat().st_size,'sha256':publish.digest(apk),'manifest':{'application_id':'cn.qingdan.android','version_name':'0.1.1'}})
        (self.root/'SHA256SUMS-android.txt').write_text(f'{publish.digest(apk)}  {apk.name}\n')

    def zip(self,name):
        with zipfile.ZipFile(self.root/name,'w') as archive:
            archive.writestr('payload',os.urandom(2048))
    def json(self,name,value):
        (self.root/name).write_text(json.dumps(value))
    def collect(self,ready=False):
        return publish.collect(self.root,'1.1.1','0.1.1',ready)
    def test_draft_requires_all_four_independent_deliverables(self):
        expected,files=self.collect()
        self.assertEqual(set(expected),{'macos','windows','linux','server'})
    def test_complete_requires_actual_apk(self):
        with self.assertRaisesRegex(ValueError,'Missing android'):
            self.collect(True)
        self.android()
        self.assertIn('android',self.collect(True)[0])
    def test_signature_report_must_pass(self):
        self.zip('Qingdan-0.1.1-android.apk')
        self.json('Qingdan-0.1.1-android.apk.verification.json',{'installable_candidate':False})
        with self.assertRaisesRegex(ValueError,'signature'):
            self.collect(True)
    def test_unsigned_or_unapproved_apk_cannot_publish(self):
        self.zip('app-release-unsigned.apk')
        with self.assertRaisesRegex(ValueError,'APK may only publish'):
            self.collect()
    def test_key_never_in_release_inventory(self):
        (self.root/'release.p12').write_text('synthetic-test-only')
        with self.assertRaisesRegex(ValueError,'Private signing'):
            self.collect()
    def test_symlink_rejected(self):
        (self.root/'linked.txt').symlink_to('verified-mac-arm64.json')
        with self.assertRaisesRegex(ValueError,'regular files'):
            self.collect()
    def test_fake_dmg_rejected(self):
        (self.root/'Qingdan-1.1.1-mac-arm64.dmg').write_bytes(b'\0'*1600)
        with self.assertRaisesRegex(ValueError,'UDIF'):
            self.collect()
    def test_fake_appimage_rejected(self):
        (self.root/'Qingdan-1.1.1-linux-x64.AppImage').write_bytes(b'\x7fELF'+b'\0'*1600)
        with self.assertRaisesRegex(ValueError,'AppImage'):
            self.collect()
    def test_server_smoke_must_have_run(self):
        self.json('qingdan-server-v1.1.1.verification.json',{'version':'1.1.1','status':'passed','smoke':{'status':'not_run'}})
        with self.assertRaisesRegex(ValueError,'runtime smoke'):
            self.collect()
    def test_packaged_backend_version_must_match(self):
        self.json('verified-win-x64.json',{'version':'1.1.1','backendVersion':'1.1.0','fusesVerified':True})
        with self.assertRaisesRegex(ValueError,'snapshot'):
            self.collect()
    def test_checksum_streaming(self):
        self.assertEqual(publish.digest(self.root/'Qingdan-1.1.1-win-x64.zip'),__import__('hashlib').sha256((self.root/'Qingdan-1.1.1-win-x64.zip').read_bytes()).hexdigest())
    def test_404_optional_only(self):
        result=__import__('subprocess').CompletedProcess([],1,'','HTTP 404: Not Found')
        with patch.object(publish.subprocess,'run',return_value=result):
            self.assertIsNone(publish.gh('fake',optional=True))
        result.stderr='HTTP 403: access denied'
        with patch.object(publish.subprocess,'run',return_value=result), self.assertRaises(RuntimeError):
            publish.gh('fake',optional=True)


class Reconcile(Assets):
    def asset(self, path, asset_id=1, name=None):
        return {'id': asset_id, 'name': name or path.name, 'size': path.stat().st_size,
                'digest': 'sha256:' + publish.digest(path)}
    def test_normalizes_ascii_names_and_evidence_without_changing_payload(self):
        before = {ext: publish.digest(self.root/f'Qingdan-1.1.1-mac-arm64.{ext}') for ext in ('dmg', 'zip')}
        for ext in before:
            (self.root/f'Qingdan-1.1.1-mac-arm64.{ext}').rename(self.root/f'青单-1.1.1-mac-arm64.{ext}')
        for name in ('verified-mac-arm64-archives.json', 'SHA256SUMS-macos.txt'):
            path = self.root/name
            path.write_text(path.read_text().replace('Qingdan-1.1.1-mac', '青单-1.1.1-mac'))
        publish.normalize_macos(self.root, '1.1.1')
        self.assertEqual(self.collect()[0]['macos'], 'Qingdan-1.1.1-mac-arm64.dmg')
        self.assertEqual(json.loads((self.root/'verified-mac-arm64-archives.json').read_text())['appName'], '青单.app')
        normalized = {path.name: path.read_bytes() for path in self.root.iterdir()}
        publish.normalize_macos(self.root, '1.1.1')
        self.assertEqual(normalized, {path.name: path.read_bytes() for path in self.root.iterdir()})
        for ext, value in before.items():
            self.assertEqual(publish.digest(self.root/f'Qingdan-1.1.1-mac-arm64.{ext}'), value)
    def test_safe_legacy_asset_rename_plan(self):
        path = self.root/'Qingdan-1.1.1-mac-arm64.dmg'
        remote = {'assets': [self.asset(path, 51, '-1.1.1-mac-arm64.dmg')]}
        self.assertEqual(publish.draft_plan(remote, [path], {}, '1.1.1'), ([(51, path.name)], [], []))
    def test_unknown_asset_rejected(self):
        path = self.root/'Qingdan-1.1.1-mac-arm64.dmg'
        remote = {'assets': [self.asset(path, name='unknown.dmg')]}
        with self.assertRaisesRegex(ValueError, 'Unknown existing draft asset'):
            publish.draft_plan(remote, [path], {}, '1.1.1')
    def test_mismatched_digest_rejected(self):
        path = self.root/'Qingdan-1.1.1-mac-arm64.dmg'
        asset = self.asset(path, name='-1.1.1-mac-arm64.dmg')
        asset['digest'] = 'sha256:' + 'f' * 64
        with self.assertRaisesRegex(ValueError, 'size/digest differs'):
            publish.draft_plan({'assets': [asset]}, [path], {}, '1.1.1')
    def test_missing_digest_rejected(self):
        path = self.root/'Qingdan-1.1.1-mac-arm64.dmg'
        asset = self.asset(path)
        del asset['digest']
        with self.assertRaisesRegex(ValueError, 'size/digest differs'):
            publish.draft_plan({'assets': [asset]}, [path], {}, '1.1.1')
    def test_duplicate_existing_candidate_preserved(self):
        path = self.root/'Qingdan-1.1.1-mac-arm64.dmg'
        remote = {'assets': [self.asset(path, 1), self.asset(path, 2, '-1.1.1-mac-arm64.dmg')]}
        with self.assertRaisesRegex(ValueError, 'Duplicate existing draft candidate'):
            publish.draft_plan(remote, [path], {}, '1.1.1')
    def test_only_verified_original_metadata_may_be_replaced(self):
        path = self.root/'SHA256SUMS-macos.txt'
        old = publish.byte_record(path.name, b'original trusted evidence')
        remote = {'assets': [{'id': 1, 'name': path.name, 'size': old['bytes'], 'digest': 'sha256:' + old['sha256']}]}
        self.assertEqual(publish.draft_plan(remote, [path], {path.name: old}, '1.1.1'), ([], [path.name], []))
    def test_final_inventory_requires_every_digest_and_no_duplicate(self):
        path = self.root/'Qingdan-1.1.1-mac-arm64.dmg'
        release = {'target_commitish': 'a'*40, 'assets': [self.asset(path)]}
        publish.verify_remote_inventory(release, [path], 'a'*40)
        release['assets'].append(self.asset(path, 2))
        with self.assertRaisesRegex(ValueError, 'exact candidate set'):
            publish.verify_remote_inventory(release, [path], 'a'*40)
    def test_exact_complete_inventory_count(self):
        self.android()
        self.assertEqual(len(self.collect(True)[1]), 25)
        (self.root/'unexpected.txt').write_text('unexpected')
        with self.assertRaisesRegex(ValueError, 'exact candidate set'):
            self.collect(True)
    def test_rest_assets_are_used_for_numeric_ids_and_digests(self):
        overview = {'apiUrl':'https://api.github.com/repos/owner/repo/releases/123'}
        rest = {'tag_name':'v1.1.1','assets':[],'id':123}
        with patch.object(publish, 'gh', side_effect=[json.dumps(overview), json.dumps(rest)]) as github:
            self.assertEqual(publish.remote_release('owner/repo','v1.1.1'), rest)
            self.assertEqual(github.call_args_list[1].args, ('api', overview['apiUrl']))

    def test_main_recovers_verified_legacy_draft_with_original_provenance(self):
        self.android()
        for ext in ('dmg', 'zip'):
            (self.root/f'Qingdan-1.1.1-mac-arm64.{ext}').rename(self.root/f'青单-1.1.1-mac-arm64.{ext}')
        for name in ('verified-mac-arm64-archives.json', 'SHA256SUMS-macos.txt'):
            path = self.root/name
            path.write_text(path.read_text().replace('Qingdan-1.1.1-mac', '青单-1.1.1-mac'))
        source = 'a' * 40
        records = [publish.file_record(path) for path in sorted(self.root.iterdir())]
        expected = {'macos': '青单-1.1.1-mac-arm64.dmg', 'windows': 'Qingdan-1.1.1-win-x64.zip',
                    'server': 'qingdan-server-v1.1.1.zip', 'linux': 'Qingdan-1.1.1-linux-x64.AppImage',
                    'android': 'Qingdan-0.1.1-android.apk'}
        legacy_manifest = publish.byte_record('RELEASE-MANIFEST.json', publish.encoded_json(
            publish.manifest_value('1.1.1', source, True, expected, records)))
        records.append(legacy_manifest)
        state = {'tag_name': 'v1.1.1', 'draft': True, 'target_commitish': source,
                 'html_url': 'https://github.com/owner/repo/releases/tag/v1.1.1',
                 'assets': [{'id': i + 1, 'name': r['name'].replace('青单-', '-'),
                             'size': r['bytes'], 'digest': 'sha256:' + r['sha256']} for i, r in enumerate(records)]}
        calls = []
        def github(*args, **kwargs):
            calls.append(args)
            if args[:2] == ('release', 'view'):
                return json.dumps({'apiUrl': 'https://api.github.com/repos/owner/repo/releases/1'})
            if args[:2] == ('api', 'https://api.github.com/repos/owner/repo/releases/1'):
                return json.dumps(state)
            if args[0] == 'api' and '/git/ref/tags/' in args[1]:
                return None
            if args[:3] == ('api', '--method', 'PATCH'):
                asset_id = int(args[3].rsplit('/', 1)[1])
                next(a for a in state['assets'] if a['id'] == asset_id)['name'] = args[5].split('=', 1)[1]
            elif args[:2] == ('release', 'upload'):
                for value in args[6:]:
                    path = Path(value)
                    old = next((a for a in state['assets'] if a['name'] == path.name), None)
                    item = self.asset(path, old['id'] if old else len(state['assets']) + 1)
                    if old:
                        old.update(item)
                    else:
                        state['assets'].append(item)
            elif args[:2] == ('release', 'edit') and '--draft=false' in args:
                state['draft'] = False
            return ''
        env = {'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_SHA': 'b' * 40, 'GITHUB_RUN_ID': '200',
               'GITHUB_STEP_SUMMARY': str(self.root.parent / (self.root.name + '-summary'))}
        self.addCleanup(lambda: Path(env['GITHUB_STEP_SUMMARY']).unlink(missing_ok=True))
        # This recovery fixture deliberately models v1.1.1. It must not depend
        # on the repository's current intentional release request.
        read_text = Path.read_text
        def fixture_text(path, *args, **kwargs):
            if path == Path('.github/release/request.json'):
                return json.dumps({'version': '1.1.1', 'androidVersion': '0.1.1'})
            return read_text(path, *args, **kwargs)
        with patch.dict(os.environ, env), patch.object(publish, 'gh', side_effect=github), \
                patch.object(Path, 'read_text', fixture_text):
            publish.main(['--assets', str(self.root), '--android-result', 'success',
                          '--source-commit', source, '--source-run-id', '100'])
        self.assertFalse(state['draft'])
        self.assertEqual(len(state['assets']), 26)
        patches = [call for call in calls if call[:3] == ('api', '--method', 'PATCH')]
        self.assertEqual(len(patches), 2)
        uploads = [call for call in calls if call[:2] == ('release', 'upload')]
        self.assertEqual({Path(p).name for p in uploads[0][6:]},
                         {'verified-mac-arm64-archives.json', 'SHA256SUMS-macos.txt', 'RELEASE-MANIFEST.json'})
        manifest = json.loads((self.root/'RELEASE-MANIFEST.json').read_text())
        self.assertEqual(manifest['sourceCommit'], source)
        self.assertEqual(manifest['sourceRunId'], '100')
        self.assertEqual(manifest['publishingRunId'], '200')
        self.assertTrue(manifest['sourceRunUrl'].endswith('/100'))
        self.assertTrue(manifest['publishingRunUrl'].endswith('/200'))
    def test_source_overrides_validate_before_github(self):
        env = {'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_SHA': 'b' * 40, 'GITHUB_RUN_ID': '200'}
        for source, run, error in [('a'*39, '100', 'Invalid workflow source'),
                                   ('a'*40, '0', 'Invalid workflow run ID'),
                                   ('a'*40, '../100', 'Invalid workflow run ID')]:
            with self.subTest(source=source, run=run), patch.dict(os.environ, env), \
                 patch.object(publish, 'gh') as github, self.assertRaisesRegex(ValueError, error):
                publish.main(['--assets', str(self.root), '--android-result', 'success',
                              '--source-commit', source, '--source-run-id', run])
            github.assert_not_called()

if __name__=='__main__':unittest.main()
