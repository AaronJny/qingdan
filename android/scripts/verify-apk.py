#!/usr/bin/env python3
"""Verify an existing APK without creating/opening keys or claiming a runtime pass.

By default all payload, source identity, signature and 16KiB ZIP alignment gates
must pass. Explicit --structural-only never reports an installable candidate.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
EXPECTED_ABIS = {
    "arm64-v8a": (2, 183), "armeabi-v7a": (1, 40),
    "x86": (1, 3), "x86_64": (2, 62),
}


class VerificationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def source_identity():
    text = (ROOT / "android/app/build.gradle").read_text()
    for property_name in ("versionCode", "versionName"):
        require(re.search(r"^\s*" + property_name + r"\s*=", text, re.MULTILINE) is not None,
                f"{property_name} must use explicit assignment to avoid Groovy command-call parsing")
    patterns = {
        "application_id": r"applicationId\s+['\"]([^'\"]+)['\"]",
        "version_name": r"versionName[^\n]*\?:\s*['\"]([^'\"]+)['\"]",
        "version_code": r"versionCode[^\n]*\?:\s*['\"](\d+)['\"]",
        "min_sdk": r"minSdk\s+(\d+)",
        "target_sdk": r"targetSdk\s+(\d+)",
    }
    result = {}
    for key, pattern in patterns.items():
        match = re.search(pattern, text)
        require(match is not None, f"Cannot read {key} from Android build.gradle")
        result[key] = match.group(1) if key in {"application_id", "version_name"} else int(match.group(1))
    result["version_name"] = os.environ.get("QINGDAN_ANDROID_VERSION_NAME") or result["version_name"]
    result["version_code"] = int(os.environ.get("QINGDAN_ANDROID_VERSION_CODE") or result["version_code"])
    require(result["version_code"] > 0, "Android versionCode must be positive")
    return result


def verify_elf(data, name):
    require(len(data) >= 64 and data[:4] == b"\x7fELF", f"Invalid ELF: {name}")
    elf_class, byte_order = data[4], data[5]
    require(elf_class in {1, 2} and byte_order in {1, 2}, f"Unsupported ELF header: {name}")
    abi = name.split("/")[1]
    require(abi in EXPECTED_ABIS, f"Unexpected ABI: {abi}")
    endian = "<" if byte_order == 1 else ">"
    machine = struct.unpack_from(endian + "H", data, 18)[0]
    require((elf_class, machine) == EXPECTED_ABIS[abi], f"ELF architecture differs from ABI: {name}")
    elf64 = elf_class == 2
    phoff = struct.unpack_from(endian + ("Q" if elf64 else "I"), data, 32 if elf64 else 28)[0]
    phentsize, phnum = struct.unpack_from(endian + "HH", data, 54 if elf64 else 42)
    require(phnum > 0 and phentsize >= (56 if elf64 else 32), f"Invalid ELF program headers: {name}")
    require(phoff + phentsize * phnum <= len(data), f"Truncated ELF program headers: {name}")
    alignments = []
    for index in range(phnum):
        offset = phoff + index * phentsize
        if struct.unpack_from(endian + "I", data, offset)[0] != 1:
            continue
        file_offset = struct.unpack_from(endian + ("Q" if elf64 else "I"), data, offset + (8 if elf64 else 4))[0]
        virtual_address = struct.unpack_from(endian + ("Q" if elf64 else "I"), data, offset + (16 if elf64 else 8))[0]
        alignment = struct.unpack_from(endian + ("Q" if elf64 else "I"), data, offset + (48 if elf64 else 28))[0]
        require(alignment >= 16384 and alignment & (alignment - 1) == 0,
                f"ELF LOAD alignment is below 16KiB or invalid: {name}")
        require((virtual_address - file_offset) % 16384 == 0,
                f"ELF LOAD offsets are not 16KiB congruent: {name}")
        alignments.append(alignment)
    require(alignments, f"ELF has no LOAD segments: {name}")
    return {"jni": name, "elf_class": 64 if elf64 else 32,
            "load_alignment": alignments, "sha256": hashlib.sha256(data).hexdigest()}


def verify_payload(apk, assets):
    require(apk.is_file(), f"APK does not exist: {apk}")
    require((assets / "web/index.html").is_file() and (assets / "web/assets").is_dir(),
            "Current bundled web assets are missing; run build-web.mjs first")
    expected = {"assets/" + p.relative_to(assets).as_posix(): p for p in assets.rglob("*") if p.is_file()}
    require(any(name.startswith("assets/migrations/") and name.endswith(".sql") for name in expected),
            "Current bundled migrations are missing")
    libraries = {}
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), "APK contains duplicate ZIP entries")
        require(archive.testzip() is None, "APK contains a bad ZIP CRC")
        require({"AndroidManifest.xml", "classes.dex"}.issubset(names), "APK is missing manifest or DEX")
        actual_assets = {name for name in names if name.startswith("assets/") and not name.endswith("/")}
        generated_assets = {"assets/dexopt/baseline.prof", "assets/dexopt/baseline.profm"}
        require(set(expected).issubset(actual_assets) and actual_assets - set(expected) <= generated_assets,
                "APK asset names differ from the current source bundle")
        for name, path in expected.items():
            require(archive.read(name) == path.read_bytes(), f"APK asset bytes differ from current source: {name}")
        for name in names:
            lower = name.lower()
            require(not any(marker in lower for marker in ("keystore", "adbkey", "password", "id_rsa"))
                    and not lower.endswith((".jks", ".p12", ".pfx", ".pk8", ".key", ".db", ".sqlite", ".sqlite3"))
                    and not Path(lower).name.startswith(".env"), f"Unexpected credential/database payload name: {name}")
            if name.startswith("lib/") and name.endswith(".so"):
                require(len(name.split("/")) == 3, f"Invalid native library entry: {name}")
                abi = name.split("/")[1]
                libraries.setdefault(abi, []).append(verify_elf(archive.read(name), name))
            if name.startswith("assets/web/assets/") and name.endswith(".js"):
                require(b"node:sqlite" not in archive.read(name), f"Node SQLite dependency in APK JavaScript: {name}")
    require(set(libraries) == set(EXPECTED_ABIS), "APK must contain all four expected Android ABIs")
    for abi, files in libraries.items():
        require(any(item["jni"] == f"lib/{abi}/libsqliteJni.so" for item in files),
                f"Bundled SQLite JNI engine missing for {abi}")
    return {"apk": apk.name, "bytes": apk.stat().st_size,
            "sha256": hashlib.sha256(apk.read_bytes()).hexdigest(),
            "apk_assets_matched_current_source": len(expected), "crc_all_entries_passed": True,
            "abis": libraries, "no_suspicious_private_payload_names": True,
            "no_node_sqlite_dependency_in_bundled_js": True}


def run_tool(tool, args):
    require(tool.is_file() and os.access(tool, os.X_OK), f"Required preinstalled SDK tool is unavailable: {tool}")
    result = subprocess.run([str(tool), *args], text=True, capture_output=True, timeout=120)
    require(result.returncode == 0, f"{tool.name} verification failed: {(result.stderr or result.stdout).strip()}")
    return result.stdout


def verify_manifest(text, expected):
    package = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']*)'", text, re.MULTILINE)
    minimum = re.search(r"^sdkVersion:'(\d+)'", text, re.MULTILINE)
    target = re.search(r"^targetSdkVersion:'(\d+)'", text, re.MULTILINE)
    require(package is not None and minimum is not None and target is not None,
            "aapt output does not contain a complete APK identity")
    identity = {"application_id": package.group(1), "version_code": int(package.group(2)),
                "version_name": package.group(3), "min_sdk": int(minimum.group(1)), "target_sdk": int(target.group(1))}
    require(identity == expected, f"APK manifest identity differs from expected source: {identity}")
    require(not re.search(r"^application-debuggable(?:\s|$)", text, re.MULTILINE), "APK is a debuggable build")
    launcher = re.search(r"^launchable-activity: name='([^']+)'", text, re.MULTILINE)
    require(launcher is not None and launcher.group(1) == expected["application_id"] + ".MainActivity",
            "APK launcher activity is missing or unexpected")
    return identity


def verify_signature(text, expected_certificate=None):
    require(re.search(r"Verified using v2 scheme .*: true", text) is not None,
            "APK v2 signature is required for the supported Android API26 floor")
    certificates = re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)$", text, re.MULTILINE)
    require(len(certificates) == 1 and len(certificates[0]) == 64, "Expected exactly one APK signing certificate")
    fingerprint = certificates[0].lower()
    if expected_certificate:
        normalized = expected_certificate.lower().replace(":", "")
        require(re.fullmatch(r"[0-9a-f]{64}", normalized) is not None, "Expected certificate must be a SHA256 fingerprint")
        require(fingerprint == normalized, "APK signer differs from the expected approved public certificate")
    return {"verified": True, "certificate_sha256": fingerprint, "v2_verified": True,
            "v3_verified": re.search(r"Verified using v3 scheme .*: true", text) is not None,
            "expected_certificate_matched": bool(expected_certificate)}


def verify(apk, assets, build_tools, structural_only=False, expected_certificate=None, expected=None):
    report = {"schema": "qingdan-android-apk-verification-v2", **verify_payload(apk, assets)}
    report.update({"signature": {"verified": False}, "manifest_identity_verified": False,
                   "zip_16k_alignment_verified": False, "installable_candidate": False,
                   "device_install_launch_verified": False, "in_place_upgrade_verified": False})
    if not structural_only:
        require(build_tools is not None, "Signed APK verification requires preinstalled SDK Build Tools36.0.0; use --build-tools")
        expected = expected or source_identity()
        report["manifest"] = verify_manifest(run_tool(build_tools / "aapt", ["dump", "badging", str(apk)]), expected)
        report["manifest_identity_verified"] = True
        report["signature"] = verify_signature(run_tool(build_tools / "apksigner", ["verify", "--verbose", "--print-certs", str(apk)]), expected_certificate)
        run_tool(build_tools / "zipalign", ["-c", "-P", "16", "-v", "4", str(apk)])
        report["zip_16k_alignment_verified"] = True
        report["installable_candidate"] = True
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path, nargs="?", default=ROOT / "artifacts/Qingdan-0.3.5-android.apk")
    parser.add_argument("--assets", type=Path, default=ROOT / "android/app/src/main/assets")
    parser.add_argument("--report", type=Path, default=ROOT / "artifacts/APK-INDEPENDENT-VERIFICATION.json")
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    parser.add_argument("--build-tools", type=Path, default=Path(sdk) / "build-tools/36.0.0" if sdk else None)
    parser.add_argument("--structural-only", action="store_true", help="Check unsigned payloads only; never marks them installable")
    parser.add_argument("--expected-cert-sha256", default=os.environ.get("QINGDAN_ANDROID_CERT_SHA256"))
    args = parser.parse_args()
    try:
        report = verify(args.apk.resolve(), args.assets.resolve(), args.build_tools,
                        args.structural_only, args.expected_cert_sha256)
    except (VerificationError, OSError, zipfile.BadZipFile, struct.error, subprocess.TimeoutExpired) as error:
        print(f"APK verification failed: {error}", file=sys.stderr)
        return 1
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
