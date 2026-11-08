"""The release wrapper must preserve native proof and bind exact final bytes."""
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / 'assemble-debian-evidence.cjs'

class DebianEvidence(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = 'Qingdan-1.3.11-linux-amd64.deb'
        self.bytes = b'exact native-validated package fixture'
        self.checksum = hashlib.sha256(self.bytes).hexdigest()
        for name in ['desktop/dist', 'validation']:
            (self.root / name).mkdir(parents=True, exist_ok=True)
        (self.root / 'desktop/dist' / self.archive).write_bytes(self.bytes)
        self.write('desktop/package.json', {'version': '1.3.11'})
        self.write('desktop/dist/verified-linux-deb-amd64.json', {'version': '1.3.11', 'archiveSha256': self.checksum})
        self.lifecycle = {k: True for k in ['install', 'samePayloadVersionUpgrade', 'reinstall', 'remove', 'purge', 'userDataPreserved', 'globalUsernsPolicyUnchanged']}
        self.lifecycle.update(guiExitStatus=0, mcpExitStatus=0, historicalDataMigrationTested=False)
        self.write('validation/lifecycle.json', self.lifecycle)
        self.write('validation/installed-gui.json', {'passed': True, 'test': 'unchanged GUI report'})
        self.write('validation/installed-mcp.json', {'passed': True, 'test': 'unchanged MCP report'})

    def write(self, name, value):
        (self.root / name).write_text(json.dumps(value))

    def invoke(self):
        return subprocess.run(['node', str(SCRIPT.resolve())], cwd=self.root, capture_output=True, text=True)

    def test_exact_bytes_and_unchanged_native_reports(self):
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads((self.root / 'validation/verified-linux-deb-native-amd64.json').read_text())
        self.assertEqual(report['archive'], self.archive)
        self.assertEqual(report['archiveSha256'], self.checksum)
        self.assertEqual(report['archiveBytes'], len(self.bytes))
        self.assertEqual(report['lifecycle'], self.lifecycle)
        self.assertEqual(report['gui'], {'passed': True, 'test': 'unchanged GUI report'})
        self.assertEqual(report['mcp'], {'passed': True, 'test': 'unchanged MCP report'})

    def test_stale_package_hash_or_version_rejected(self):
        for version, checksum in [('1.3.10', self.checksum), ('1.3.11', '0' * 64)]:
            self.write('desktop/dist/verified-linux-deb-amd64.json', {'version': version, 'archiveSha256': checksum})
            self.assertNotEqual(self.invoke().returncode, 0)

    def test_each_failed_lifecycle_or_smoke_cannot_be_bound(self):
        for key in self.lifecycle:
            if key == 'historicalDataMigrationTested':
                continue
            bad = self.lifecycle | {key: 1 if key.endswith('Status') else False}
            self.write('validation/lifecycle.json', bad)
            self.assertNotEqual(self.invoke().returncode, 0, key)
        self.write('validation/lifecycle.json', self.lifecycle)
        for target in ['gui', 'mcp']:
            self.write(f'validation/installed-{target}.json', {'passed': False})
            self.assertNotEqual(self.invoke().returncode, 0, target)
            self.write(f'validation/installed-{target}.json', {'passed': True})

if __name__ == '__main__':
    unittest.main()
