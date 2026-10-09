#!/usr/bin/env python3
"""Create a macOS bundle ZIP without dereferencing framework symlinks.

Used only for Linux cross-build snapshots. It does not sign or validate the app.
Native macOS builds continue using electron-builder's native archive tools.
"""
import os
import pathlib
import stat
import sys
import time
import zipfile

bundle = pathlib.Path(sys.argv[1]).resolve()
output = pathlib.Path(sys.argv[2]).resolve()
if not bundle.is_dir() or bundle.suffix != '.app':
    raise SystemExit('Expected an existing .app bundle')
output.parent.mkdir(parents=True, exist_ok=True)
base = bundle.parent
entries = []
for directory, dirs, files in os.walk(bundle, followlinks=False):
    dirs.sort(); files.sort()
    entries.append(pathlib.Path(directory))
    for name in list(dirs):
        target = pathlib.Path(directory, name)
        if target.is_symlink():
            entries.append(target)
            dirs.remove(name)
    entries.extend(pathlib.Path(directory, name) for name in files)

with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=True) as archive:
    for source in entries:
        info_stat = source.lstat()
        relative = source.relative_to(base).as_posix()
        is_link = stat.S_ISLNK(info_stat.st_mode)
        is_directory = stat.S_ISDIR(info_stat.st_mode)
        date_time = time.localtime(info_stat.st_mtime)[:6]
        if date_time[0] < 1980:
            date_time = (1980, 1, 1, 0, 0, 0)
        info = zipfile.ZipInfo(relative + ('/' if is_directory else ''), date_time)
        info.create_system = 3
        info.external_attr = (info_stat.st_mode & 0xFFFF) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        if is_directory:
            info.external_attr |= 0x10
            archive.writestr(info, b'')
        elif is_link:
            link = os.readlink(source)
            if pathlib.Path(link).is_absolute() or not source.resolve().is_relative_to(bundle):
                raise SystemExit('Refusing an external bundle symlink')
            archive.writestr(info, link.encode('utf-8'))
        elif stat.S_ISREG(info_stat.st_mode):
            with source.open('rb') as stream, archive.open(info, 'w', force_zip64=True) as writer:
                while chunk := stream.read(1024 * 1024):
                    writer.write(chunk)
        else:
            raise SystemExit('Unsupported filesystem entry in bundle')

with zipfile.ZipFile(output) as archive:
    if archive.testzip() is not None:
        raise SystemExit('ZIP CRC validation failed')
    symlinks = sum(stat.S_ISLNK(info.external_attr >> 16) for info in archive.infolist())
    logical = sum(info.file_size for info in archive.infolist())
    print(f'ZIP verified: {len(archive.infolist())} entries, {symlinks} symlinks, {logical} logical bytes, {output.stat().st_size} archive bytes')
print(output)
