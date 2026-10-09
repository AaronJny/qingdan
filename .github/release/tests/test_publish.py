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
        (self.root/'青单-1.1.1-mac-arm64.dmg').write_bytes(b'\0'*1100+b'koly'+b'\0'*508)
        (self.root/'Qingdan-1.1.1-linux-x64.AppImage').write_bytes(b'\x7fELF'+b'\0'*4+b'AI\x02'+b'\0'*1500)
        self.json('qingdan-server-v1.1.1.verification.json',{'version':'1.1.1','status':'passed','smoke':{'status':'passed'}})
        for platform,arch in [('mac','arm64'),('win','x64'),('linux','x64')]:
            self.json(f'verified-{platform}-{arch}.json',{'version':'1.1.1','backendVersion':'1.1.1','fusesVerified':{'RunAsNode':False}})
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
        self.zip('Qingdan-0.1.1-android.apk')
        apk = self.root/'Qingdan-0.1.1-android.apk'
        self.json(apk.name+'.verification.json',{'installable_candidate':True,'signature':{'verified':True,'v2_verified':True},'manifest_identity_verified':True,'zip_16k_alignment_verified':True,'apk':apk.name,'bytes':apk.stat().st_size,'sha256':publish.digest(apk),'manifest':{'application_id':'cn.qingdan.android','version_name':'0.1.1'}})
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
        (self.root/'青单-1.1.1-mac-arm64.dmg').write_bytes(b'\0'*1600)
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

if __name__=='__main__':unittest.main()
