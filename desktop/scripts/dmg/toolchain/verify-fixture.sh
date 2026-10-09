#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export TZ=UTC LC_ALL=C.UTF-8
python3 create-fixture.py
python3 validate-stage-names.py fixture/stage 青单安装 > logs/fixture-stage-names.json
truncate -s 32M fixture/unicode.hfs
root/usr/sbin/mkfs.hfsplus -v 青单安装 fixture/unicode.hfs > logs/fixture-mkfs.txt
build/hfs/hfsplus --symlinks clone_link --special-modes no fixture/unicode.hfs addall "$PWD/fixture/stage" > logs/fixture-addall.txt
python3 inspect-hfs.py fixture/unicode.hfs fixture/stage --fix-link-modes > logs/fixture-catalog.json
build/hfs/hfsplus fixture/unicode.hfs ls / > logs/fixture-ls-root.txt
build/hfs/hfsplus fixture/unicode.hfs ls /青单.app/Contents/MacOS > logs/fixture-ls-executable.txt
root/usr/sbin/fsck.hfsplus -fn fixture/unicode.hfs > logs/fixture-fsck.txt 2>&1
build/dmg/dmg build fixture/unicode.hfs fixture/青单-Unicode-fixture.dmg > logs/fixture-dmg-build.txt 2>&1
root/usr/lib/7zip/7z t fixture/青单-Unicode-fixture.dmg > logs/fixture-7z-test.txt
root/usr/lib/7zip/7z l -slt fixture/青单-Unicode-fixture.dmg > logs/fixture-7z-list.txt
root/usr/lib/7zip/7z x -y -tDmg fixture/青单-Unicode-fixture.dmg -ofixture/7z-raw > logs/fixture-7z-extract.txt
cmp fixture/unicode.hfs fixture/7z-raw/3.hfsx
python3 inspect-hfs.py fixture/7z-raw/3.hfsx fixture/stage > logs/fixture-independent-catalog.json
root/usr/sbin/fsck.hfsplus -fn fixture/7z-raw/3.hfsx > logs/fixture-independent-fsck.txt 2>&1
