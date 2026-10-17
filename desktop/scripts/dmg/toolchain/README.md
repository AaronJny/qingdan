# 青单 Linux DMG toolchain with real Unicode HFS+ names

This is a narrowly scoped Unicode repair for Mozilla libdmg-hfsplus commit `ec239599c1f234a4e01ae3fe51214d0c77e5baa3`. It writes actual HFS+ catalog UTF-16 names.

The upstream tool and its two-file patch have scoped GPLv3 [source notices](THIRD-PARTY-NOTICES.md) and a retained [license](LICENSE-libdmg-hfsplus.txt).

## Verified result

- Fixture volume: `青单安装`, actual catalog UTF-16BE `975253555b8988c5`.
- Outer app directory: `青单.app`, actual catalog UTF-16BE `97525355002e006100700070`.
- Executable path: `青单.app/Contents/MacOS/青单`, mode `0755`, actual executable name UTF-16BE `97525355`.
- 17 stage entries, including 4 symlinks: every file's bytes/hash, directory and file mode, symlink target and mode match the independent HFS+ parser.
- Debian 7-Zip 25.01 independently validates UDIF/CRC and extracts the raw HFS+ partition. That extracted image is byte-for-byte equal to the input raw image and passes the independent catalog check and `fsck.hfsplus -fn`.
- 31 UTF codec cases pass AddressSanitizer and UndefinedBehaviorSanitizer. These include ASCII, Chinese, surrogate pairs, 255-code-unit limits, malformed UTF-8 and unpaired UTF-16 rejection.
- `fixture/青单-Unicode-fixture.dmg` is a synthetic packaging fixture. Its executable is a shell test file, not the real app.

## Tool paths

Paths relative to this directory:

- `build/hfs/hfsplus`
- `build/dmg/dmg`
- `root/usr/sbin/mkfs.hfsplus`
- `root/usr/sbin/fsck.hfsplus`
- `root/usr/lib/7zip/7z` with its adjacent `7z.so`
- `build/libhfs-name-compare.so` used only by the read-only stage preflight

Do not run `root/usr/bin/7z`: Debian's wrapper references the system installation. Run the actual binary above.

## Rebuild from pinned official sources

Requirements: Linux amd64, GCC/G++, make, Python 3 with Unicode 3.2 database, curl, tar, patch, dpkg-deb, GnuPG, the official Debian archive keyring at `/usr/share/keyrings/debian-archive-keyring.gpg`, existing zlib development files and the base Debian 13 runtime libraries. This environment used GCC 14.2.0 and glibc 2.41. CMake and additional build dependencies are unpacked locally, never installed system-wide; no package maintainer scripts run.

Keep these files together:

`rebuild.sh`, `fetch-inputs.py`, `verify-inputs.py`, `fetch-pinned.py`, `provenance.json`, `unicode-utf8.patch`, `validate-stage-names.py`, `unicode-codec-test.c`, `test-codec.py`, `create-fixture.py`, `verify-fixture.sh`, and `inspect-hfs.py`.

Then run:

```sh
bash rebuild.sh
bash verify-fixture.sh
```

`rebuild.sh` downloads the exact inputs recorded in `provenance.json`, checks all SHA256 values, verifies Debian's signed Release against the existing official archive keyring, checks both package-index hashes, and checks all 9 package versions and hashes against those signed indexes. Package sources are `deb.debian.org` with the fixed 2026-09-25 Debian snapshot as fallback. The Mozilla archive is fetched from the official Mozilla GitHub repository at the fixed commit and checked against the recorded archive hash; this is not a signed-commit claim.

The build disables optional OpenSSL support in libdmg-hfsplus. `mkfs.hfsplus` and `fsck.hfsplus` retain their packaged runtime dependencies. The original and patched Mozilla source directories and their GPLv3 license are retained in this working toolchain.

## Use with the real app stage

Set `TZ=UTC` and `LC_ALL=C.UTF-8` for consistent tool output and timestamps. Before creating or importing any image:

```sh
python3 validate-stage-names.py /absolute/path/to/stage 青单安装
```

This command does not alter names. It checks strict UTF-8, 255 UTF-16 code-unit limits, upstream's 1024-byte path buffers, existing HFS+ Unicode 3.2 canonical decomposition, and sibling collisions using the same TN1150 FastUnicodeCompare function as the upstream HFS library. It does not traverse symlinks. Non-decomposed names such as NFC `é` or composed Hangul are rejected rather than silently written illegally or renamed. The Chinese names used by 青单 and ASCII Electron paths already satisfy the gate. The C patch is a codec fix, not a general normalization library.

Import with both policies explicitly set:

```sh
build/hfs/hfsplus --symlinks clone_link --special-modes no output.hfs addall /absolute/path/to/stage
python3 inspect-hfs.py output.hfs /absolute/path/to/stage --fix-link-modes
root/usr/sbin/fsck.hfsplus -fn output.hfs
build/dmg/dmg build output.hfs output.dmg
root/usr/lib/7zip/7z t output.dmg
root/usr/lib/7zip/7z x -y -tDmg output.dmg -oindependent-raw
python3 inspect-hfs.py independent-raw/3.hfsx /absolute/path/to/stage
root/usr/sbin/fsck.hfsplus -fn independent-raw/3.hfsx
```

Choose and create a suitably sized raw HFS+ file with `mkfs.hfsplus` before import. The `.hfsx` partition label above is the upstream UDIF partition naming; the independently verified filesystem signature is `H+`. The existing symlink mode correction changes only the owned raw image's catalog low permission bits to the staged symlink modes, then rechecks all bytes/modes/targets. It does not change host filesystem or security settings.

## Scope and evidence

The patch changes only `hfs/catalog.c` and `hfs/utility.c`, retaining upstream API names for compatibility while replacing lossy byte widening/truncation with strict UTF-8 ↔ UTF-16 conversion. The writer rejects invalid UTF-8 and overlong names instead of truncating or overflowing. The reader handles surrogate pairs and rejects unpaired surrogates. `printUnicode` now emits UTF-8 through the same decoder.

Important evidence files:

- `provenance.json`, `SHA256SUMS`: exact sources, versions, hashes and limits
- `unicode-utf8.patch`: minimal two-file source patch
- `logs/debian-release-signature.txt`: official Debian signature verification
- `logs/fixture-independent-catalog.json`: independent data/permissions/link and true UTF-16 catalog evidence, including volume name
- `logs/fixture-7z-test.txt`, `logs/fixture-7z-list.txt`: independent DMG test and visible Unicode names
- `logs/fixture-independent-fsck.txt`: read-only consistency check
- `logs/fixture-ls-root.txt`, `logs/fixture-ls-executable.txt`: patched tool's actual Unicode listing
- `logs/unicode-codec-tests.json`: 31 sanitizer-tested conversion cases
- `logs/fixture-stage-names.json`: read-only name gate result

Repeat the full independent sequence for every final real app image. This fixture is not evidence of native macOS mounting, Finder dragging, LaunchServices, app launching, Gatekeeper, Developer ID signing, or Apple notarization. Image timestamps and UDIF identifiers can vary; no bit-for-bit DMG reproducibility claim is made.

Format references: [Apple TN1150](https://developer.apple.com/library/archive/technotes/tn/tn1150.html), [Mozilla libdmg-hfsplus](https://github.com/mozilla/libdmg-hfsplus).
