"""Unit tests use synthetic archives/tool-output strings, never real signing keys.

These tests prove validation logic only. They do not count as an Android build,
cryptographic verification, install or device launch.
"""
import importlib.util
import os
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("verify_apk", ROOT / "scripts/verify-apk.py")
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)
IDENTITY = {"application_id": "cn.qingdan.android", "version_name": "0.2.1", "version_code": 5, "min_sdk": 26, "target_sdk": 36}
BADGING = """package: name='cn.qingdan.android' versionCode='5' versionName='0.2.1' platformBuildVersionName='16'
sdkVersion:'26'
targetSdkVersion:'36'
launchable-activity: name='cn.qingdan.android.MainActivity' label='青单' icon='res/drawable/ic_qingdan.xml'
"""
CERTIFICATE = "ab" * 32
SIGNED_OUTPUT = f"""Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Number of signers: 1
Signer #1 certificate SHA-256 digest: {CERTIFICATE}
"""
SIGNING_NAMES = ("ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD")


def elf(abi, alignment=16384, address=0, machine=None):
    cls, expected_machine = verifier.EXPECTED_ABIS[abi]
    data = bytearray(128)
    data[:6] = b"\x7fELF" + bytes([cls, 1])
    struct.pack_into("<H", data, 18, expected_machine if machine is None else machine)
    struct.pack_into("<Q" if cls == 2 else "<I", data, 32 if cls == 2 else 28, 64)
    struct.pack_into("<HH", data, 54 if cls == 2 else 42, 56 if cls == 2 else 32, 1)
    struct.pack_into("<I", data, 64, 1)
    struct.pack_into("<Q" if cls == 2 else "<I", data, 64 + (16 if cls == 2 else 8), address)
    struct.pack_into("<Q" if cls == 2 else "<I", data, 64 + (48 if cls == 2 else 28), alignment)
    return bytes(data)


class ApkVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.assets = self.root / "assets"
        for name, data in {"web/index.html": b"<html/>", "web/assets/main.js": b"console.log('test fixture')", "migrations/0000.sql": b"create table example(x);"}.items():
            path = self.assets / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.apk = self.root / "fixture.apk"
        self.entries = {"AndroidManifest.xml": b"binary-manifest-fixture", "classes.dex": b"dex-fixture"}
        self.entries.update({"assets/" + p.relative_to(self.assets).as_posix(): p.read_bytes() for p in self.assets.rglob("*") if p.is_file()})
        self.entries.update({f"lib/{abi}/libsqliteJni.so": elf(abi) for abi in verifier.EXPECTED_ABIS})
        self.write_apk()

    def write_apk(self):
        with zipfile.ZipFile(self.apk, "w", compression=zipfile.ZIP_STORED) as archive:
            for name, data in self.entries.items():
                archive.writestr(name, data)

    def rejects_payload(self, match):
        self.write_apk()
        with self.assertRaisesRegex(verifier.VerificationError, match):
            verifier.verify_payload(self.apk, self.assets)

    def test_structural_only_never_reports_installable(self):
        result = verifier.verify(self.apk, self.assets, None, structural_only=True)
        self.assertFalse(result["installable_candidate"])
        self.assertFalse(result["signature"]["verified"])
        self.assertFalse(result["device_install_launch_verified"])
        self.assertFalse(result["in_place_upgrade_verified"])
        self.assertEqual(len(result["abis"]), 4)

    def test_signed_mode_requires_real_tools(self):
        with self.assertRaisesRegex(verifier.VerificationError, "requires preinstalled"):
            verifier.verify(self.apk, self.assets, None)
        with self.assertRaisesRegex(verifier.VerificationError, "unavailable"):
            verifier.verify(self.apk, self.assets, self.root / "absent-tools")

    def test_asset_bytes_must_match_current_source(self):
        self.entries["assets/web/assets/main.js"] = b"stale"
        self.rejects_payload("asset bytes differ")

    def test_stale_extra_web_asset_rejected(self):
        self.entries["assets/web/assets/stale.js"] = b"stale"
        self.rejects_payload("asset names differ")

    def test_known_agp_generated_baseline_profiles_allowed(self):
        self.entries["assets/dexopt/baseline.prof"] = b"generated-profile-fixture"
        self.write_apk()
        verifier.verify_payload(self.apk, self.assets)

    def test_manifest_and_dex_required(self):
        del self.entries["classes.dex"]
        self.rejects_payload("manifest or DEX")

    def test_duplicate_entries_rejected(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(self.apk, "a") as archive:
                archive.writestr("classes.dex", b"duplicate")
        with self.assertRaisesRegex(verifier.VerificationError, "duplicate"):
            verifier.verify_payload(self.apk, self.assets)

    def test_every_expected_abi_required(self):
        del self.entries["lib/arm64-v8a/libsqliteJni.so"]
        self.rejects_payload("four expected")

    def test_sqlite_engine_name_required_per_abi(self):
        self.entries["lib/arm64-v8a/wrong.so"] = self.entries.pop("lib/arm64-v8a/libsqliteJni.so")
        self.rejects_payload("SQLite JNI engine missing")

    def test_all_libraries_for_each_abi_recorded(self):
        self.entries["lib/arm64-v8a/another.so"] = elf("arm64-v8a")
        self.write_apk()
        result = verifier.verify_payload(self.apk, self.assets)
        self.assertEqual(len(result["abis"]["arm64-v8a"]), 2)

    def test_four_kib_elf_rejected(self):
        self.entries["lib/arm64-v8a/libsqliteJni.so"] = elf("arm64-v8a", alignment=4096)
        self.rejects_payload("below 16KiB")

    def test_noncongruent_elf_offsets_rejected(self):
        self.entries["lib/arm64-v8a/libsqliteJni.so"] = elf("arm64-v8a", address=4096)
        self.rejects_payload("not 16KiB congruent")

    def test_elf_architecture_must_match_abi(self):
        self.entries["lib/arm64-v8a/libsqliteJni.so"] = elf("arm64-v8a", machine=62)
        self.rejects_payload("architecture differs")

    def test_private_payload_filename_rejected(self):
        self.entries["unexpected-signing.jks"] = b"not-a-key-fixture"
        self.rejects_payload("credential/database")

    def test_node_sqlite_not_packaged_in_javascript(self):
        data = b"import('node:sqlite')"
        (self.assets / "web/assets/main.js").write_bytes(data)
        self.entries["assets/web/assets/main.js"] = data
        self.rejects_payload("Node SQLite")

    def test_manifest_identity_matches(self):
        self.assertEqual(verifier.verify_manifest(BADGING, IDENTITY), IDENTITY)

    def test_manifest_wrong_version_or_sdk_rejected(self):
        for old, new in (("versionCode='5'", "versionCode='2'"), ("versionName='0.2.1'", "versionName='0.1.1'"), ("sdkVersion:'26'", "sdkVersion:'25'"), ("targetSdkVersion:'36'", "targetSdkVersion:'35'")):
            with self.subTest(new=new), self.assertRaisesRegex(verifier.VerificationError, "identity differs"):
                verifier.verify_manifest(BADGING.replace(old, new), IDENTITY)

    def test_debuggable_or_missing_launcher_rejected(self):
        with self.assertRaisesRegex(verifier.VerificationError, "debuggable"):
            verifier.verify_manifest(BADGING + "application-debuggable\n", IDENTITY)
        with self.assertRaisesRegex(verifier.VerificationError, "launcher"):
            verifier.verify_manifest(BADGING.replace("MainActivity", "UnexpectedActivity"), IDENTITY)

    def test_public_certificate_verified_and_optional_pin_checked(self):
        result = verifier.verify_signature(SIGNED_OUTPUT, CERTIFICATE)
        self.assertTrue(result["verified"])
        self.assertTrue(result["expected_certificate_matched"])
        with self.assertRaisesRegex(verifier.VerificationError, "differs"):
            verifier.verify_signature(SIGNED_OUTPUT, "cd" * 32)

    def test_missing_v2_or_extra_signer_rejected(self):
        with self.assertRaisesRegex(verifier.VerificationError, "v2 signature"):
            verifier.verify_signature(SIGNED_OUTPUT.replace("v2): true", "v2): false"))
        with self.assertRaisesRegex(verifier.VerificationError, "exactly one"):
            verifier.verify_signature(SIGNED_OUTPUT + f"Signer #2 certificate SHA-256 digest: {CERTIFICATE}\n")

    def test_all_signature_identity_alignment_gates_required(self):
        # Mocked tool outputs validate orchestration only, not a real APK signature.
        outputs = {"aapt": BADGING, "apksigner": SIGNED_OUTPUT, "zipalign": "Verification successful"}
        calls = []
        def mocked_tool(path, args):
            calls.append((path.name, args))
            return outputs[path.name]
        with patch.object(verifier, "run_tool", side_effect=mocked_tool):
            result = verifier.verify(self.apk, self.assets, self.root / "tools", expected=IDENTITY)
        self.assertTrue(result["installable_candidate"])
        self.assertEqual([name for name, _ in calls], ["aapt", "apksigner", "zipalign"])
        self.assertIn("--print-certs", calls[1][1])
        self.assertEqual(calls[2][1][:5], ["-c", "-P", "16", "-v", "4"])
        with patch.object(verifier, "run_tool", side_effect=[BADGING, SIGNED_OUTPUT, verifier.VerificationError("alignment failed")]):
            with self.assertRaisesRegex(verifier.VerificationError, "alignment failed"):
                verifier.verify(self.apk, self.assets, self.root / "tools", expected=IDENTITY)

    def test_source_identity_and_environment_overrides(self):
        with patch.dict(os.environ, {"QINGDAN_ANDROID_VERSION_NAME": "", "QINGDAN_ANDROID_VERSION_CODE": ""}):
            self.assertEqual(verifier.source_identity(), IDENTITY)
        with patch.dict(os.environ, {"QINGDAN_ANDROID_VERSION_NAME": "0.1.3", "QINGDAN_ANDROID_VERSION_CODE": "4"}):
            identity = verifier.source_identity()
            self.assertEqual((identity["version_name"], identity["version_code"]), ("0.1.3", 4))

    def test_groovy_version_properties_require_explicit_assignment(self):
        # Regression guard for the actual Actions evaluation failure. This is
        # a source-syntax guard, not a substitute for a real Gradle invocation.
        source = (ROOT / "android/app/build.gradle").read_text()
        config = self.root / "android/app/build.gradle"
        config.parent.mkdir(parents=True, exist_ok=True)
        for property_name in ("versionCode", "versionName"):
            config.write_text(source.replace(property_name + " =", property_name, 1))
            with self.subTest(property_name=property_name), patch.object(verifier, "ROOT", self.root):
                with self.assertRaisesRegex(verifier.VerificationError, property_name + " must use explicit assignment"):
                    verifier.source_identity()

    def test_android_test_fixtures_avoid_newer_jdk_library_apis(self):
        # These main-method policy tests also compile against the Android
        # bootclasspath in testReleaseUnitTest. Guard the observed missing API
        # and similar JDK conveniences, without claiming an actual SDK compile.
        unsupported = re.compile(
            r"\bFiles\.(?:readString|writeString)\s*\("
            r"|\bPath\.of\s*\("
            r"|\b(?:List|Map|Set)\.of\s*\("
            r"|\.(?:repeat|strip|stripLeading|stripTrailing|isBlank)\s*\("
            r"|(?<!Collectors)\.toList\s*\("
        )
        sources = sorted((ROOT / "android/app/src/test").rglob("*.java"))
        self.assertGreater(len(sources), 0)
        for path in sources:
            with self.subTest(path=path.name):
                self.assertIsNone(unsupported.search(path.read_text()))
        local_store = (ROOT / "android/app/src/test/java/cn/qingdan/android/LocalStorePolicyTest.java").read_text()
        self.assertIn("new String(Files.readAllBytes(path), StandardCharsets.UTF_8)", local_store)

    def test_signing_missing_gate_reports_names_without_values(self):
        environment = {name: value for name, value in os.environ.items() if name not in SIGNING_NAMES}
        result = subprocess.run(["bash", str(ROOT / "scripts/sign-release.sh"), "--check-env"], env=environment, text=True, capture_output=True)
        self.assertEqual(result.returncode, 2)
        for name in SIGNING_NAMES:
            self.assertIn(name, result.stderr)

    def test_presence_check_never_decodes_or_signs(self):
        environment = dict(os.environ, **{name: "not-a-real-key-or-password-fixture" for name in SIGNING_NAMES}, RUNNER_TEMP=str(self.root))
        before = set(self.root.iterdir())
        result = subprocess.run(["bash", str(ROOT / "scripts/sign-release.sh"), "--check-env"], env=environment, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertNotIn("not-a-real-key-or-password-fixture", result.stdout + result.stderr)
        self.assertEqual(set(self.root.iterdir()), before)


if __name__ == "__main__":
    unittest.main()
