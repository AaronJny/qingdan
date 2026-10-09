#!/usr/bin/env python3
"""Read-only ZIP preflight before native extraction; never modify the artifact."""
import argparse
import json
import posixpath
import stat
import unicodedata
import zipfile


def inspect_zip(filename, platform):
    records = {}
    logical_bytes = 0
    links = 0
    with zipfile.ZipFile(filename) as archive:
        infos = archive.infolist()
        if not infos or len(infos) > 100000:
            raise ValueError('Empty or excessively large ZIP entry table')
        for info in infos:
            name = info.filename
            parts = name.rstrip('/').split('/')
            if (not name or '\\' in name or ':' in name or name.startswith('/')
                    or any(part in ('', '.', '..') for part in parts)
                    or any(ord(char) < 32 or ord(char) == 127 for char in name)):
                raise ValueError('Unsafe ZIP path: ' + repr(name))
            if platform == 'win' and any(
                    part.endswith((' ', '.')) or
                    part.split('.')[0].upper() in
                    ('CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)),
                     *(f'LPT{i}' for i in range(1, 10))) for part in parts):
                raise ValueError('Unsafe Windows ZIP path: ' + repr(name))
            key = unicodedata.normalize('NFC', name.rstrip('/')).casefold()
            if key in records:
                raise ValueError('Duplicate or case/Unicode-colliding ZIP path: ' + repr(name))
            if info.flag_bits & 1 or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError('Encrypted or unsupported ZIP entry: ' + repr(name))
            mode = info.external_attr >> 16
            kind = stat.S_IFMT(mode)
            is_link = kind == stat.S_IFLNK
            if is_link and platform != 'mac':
                raise ValueError('Windows ZIP must not contain symlinks')
            if kind not in (0, stat.S_IFREG, stat.S_IFDIR, stat.S_IFLNK):
                raise ValueError('Unsupported ZIP filesystem entry: ' + repr(name))
            if info.is_dir() != (kind == stat.S_IFDIR) and kind not in (0, stat.S_IFREG):
                raise ValueError('ZIP type/name mismatch: ' + repr(name))
            logical_bytes += info.file_size
            if info.file_size > 2 * 1024**3 or logical_bytes > 8 * 1024**3:
                raise ValueError('ZIP exceeds bounded desktop payload size')
            # Reading to EOF makes zipfile validate the CRC of every entry.
            with archive.open(info) as stream:
                if is_link:
                    if info.file_size > 4096:
                        raise ValueError('Excessive ZIP symlink target')
                    target = stream.read().decode('utf-8')
                    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
                    bundle = parts[0]
                    if (not bundle.endswith('.app') or not target or target.startswith('/')
                            or '\\' in target or ':' in target or '\x00' in target
                            or not resolved.startswith(bundle + '/')):
                        raise ValueError('ZIP symlink escapes its app bundle: ' + repr(name))
                    links += 1
                else:
                    while stream.read(1024 * 1024):
                        pass
            records[key] = 'directory' if info.is_dir() else 'symlink' if is_link else 'file'
        # Native extractors must not write an entry through a preceding symlink.
        for name in records:
            parent = posixpath.dirname(name)
            while parent:
                if parent in records and records[parent] != 'directory':
                    raise ValueError('ZIP entry descends through a non-directory: ' + name)
                parent = posixpath.dirname(parent)
    return {'entries': len(records), 'symlinks': links, 'logicalBytes': logical_bytes,
            'allEntryCrcsVerified': True, 'safePathsVerified': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('zip')
    parser.add_argument('--platform', choices=('mac', 'win'), required=True)
    args = parser.parse_args()
    print(json.dumps(inspect_zip(args.zip, args.platform), ensure_ascii=False))


if __name__ == '__main__':
    main()
