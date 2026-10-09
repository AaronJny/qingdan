#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export TZ=UTC LC_ALL=C.UTF-8
mkdir -p downloads src build root logs
python3 fetch-inputs.py
python3 verify-inputs.py
python3 fetch-pinned.py
SOURCE='src/libdmg-hfsplus-ec239599c1f234a4e01ae3fe51214d0c77e5baa3'
python3 - <<'PY'
import hashlib,json,pathlib
r=pathlib.Path('.')
manifest=json.loads((r/'provenance.json').read_text())
f=r/manifest['mozillaSource']['file']
assert hashlib.sha256(f.read_bytes()).hexdigest()==manifest['mozillaSource']['sha256']
PY
# Re-extract the fixed upstream tarball and apply the reviewed two-file patch.
tar xzf downloads/libdmg-hfsplus-ec239599.tar.gz -C src
patch -d "$SOURCE" -p1 < unicode-utf8.patch
export LD_LIBRARY_PATH="$PWD/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
root/usr/bin/cmake -S "$SOURCE" -B build \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_DISABLE_FIND_PACKAGE_OpenSSL=TRUE \
  -DCMAKE_PREFIX_PATH="$PWD/root/usr" \
  -DBZIP2_LIBRARY_RELEASE="$PWD/root/usr/lib/x86_64-linux-gnu/libbz2.a" \
  -DLIBLZMA_LIBRARY="$PWD/root/usr/lib/x86_64-linux-gnu/liblzma.a" \
  -DCMAKE_EXE_LINKER_FLAGS="-L$PWD/root/usr/lib/x86_64-linux-gnu"
root/usr/bin/cmake --build build -j4
gcc -O2 -shared -fPIC -I "$SOURCE/includes" "$SOURCE/hfs/fastunicodecompare.c" -o build/libhfs-name-compare.so
gcc -O1 -g -fsanitize=address,undefined -ffunction-sections -fdata-sections \
  -Wl,--gc-sections -I "$SOURCE/includes" unicode-codec-test.c \
  "$SOURCE/hfs/catalog.c" "$SOURCE/hfs/utility.c" -o unicode-codec-test
python3 test-codec.py > logs/unicode-codec-tests.json
