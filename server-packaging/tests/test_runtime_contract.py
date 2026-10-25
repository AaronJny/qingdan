"""Keep build tooling and bundled runtime on the reviewed security release."""
from pathlib import Path
import re
import sys
import unittest

PACKAGING = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGING))
import release_contract as contract


class RuntimeContractTests(unittest.TestCase):
    def test_bundled_runtime_is_reviewed_security_release(self):
        # Node's October 2026 security release includes CVE-2026-111497.
        self.assertEqual(contract.NODE_VERSION, '24.22.1')
        self.assertEqual(contract.NODE_URL, 'https://nodejs.org/dist/v24.22.1/')
        self.assertEqual(set(contract.ARCHIVE_SHA256), {'linux-x64', 'darwin-arm64'})
        self.assertEqual(set(contract.BINARY_SHA256), set(contract.ARCHIVE_SHA256))
        for arch in contract.ARCHIVE_SHA256:
            self.assertRegex(contract.ARCHIVE_SHA256[arch], r'^[a-f0-9]{64}$')
            self.assertRegex(contract.BINARY_SHA256[arch], r'^[a-f0-9]{64}$')
            self.assertGreater(contract.ARCHIVE_BYTES[arch], 0)

    def test_docker_build_and_runtime_use_patched_official_image(self):
        # Multi-platform manifest verified against Docker Hub's library/node tag.
        image = ('node:24.22.1-bookworm-slim@sha256:'
                 '55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205')
        for name in ('application/Dockerfile', 'android/webapp/Dockerfile'):
            dockerfile = (PACKAGING.parent / name).read_text()
            self.assertEqual(re.findall(r'^FROM (\S+)', dockerfile, re.MULTILINE), [image, image])

    def test_ci_and_downloads_match_bundled_runtime(self):
        workflows = PACKAGING.parent / '.github' / 'workflows'
        check = (workflows / 'check.yml').read_text()
        versions = re.findall(r"node-version: '([^']+)'", check)
        self.assertTrue(versions)
        self.assertEqual(set(versions), {contract.NODE_VERSION})
        release = (workflows / 'release.yml').read_text()
        self.assertIn(f"NODE_VERSION: '{contract.NODE_VERSION}'", release)
        self.assertIn(contract.NODE_URL, release)
        for arch in contract.ARCHIVE_SHA256:
            self.assertIn(f'node-v{contract.NODE_VERSION}-{arch}.tar.xz', release)


if __name__ == '__main__':
    unittest.main()
