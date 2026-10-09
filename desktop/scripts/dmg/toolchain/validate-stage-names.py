#!/usr/bin/env python3
"""Read-only HFS+ name gate. No renaming, normalization, traversal of symlinks."""
import ctypes,functools,json,os,struct,sys,unicodedata
from pathlib import Path
root=Path(__file__).resolve().parent
ucd=unicodedata.ucd_3_2_0
lib=ctypes.CDLL(str(root/'build/libhfs-name-compare.so'))
compare=lib.FastUnicodeCompare
compare.argtypes=[ctypes.POINTER(ctypes.c_uint16),ctypes.c_uint16,ctypes.POINTER(ctypes.c_uint16),ctypes.c_uint16]
compare.restype=ctypes.c_int32

def hfs_normalized(s):
    # TN1150: retain punctuation/symbol and CJK compatibility exception blocks.
    chunks=[]; pending=''
    for c in s:
        n=ord(c)
        if 0x2000<=n<=0x2fff or 0xf900<=n<=0xfaff:
            chunks.extend([ucd.normalize('NFD',pending),c]);pending=''
        else:pending+=c
    chunks.append(ucd.normalize('NFD',pending))
    return ''.join(chunks)

def utf16(s):
    b=s.encode('utf-16-le');n=len(b)//2
    return (ctypes.c_uint16*n)(*struct.unpack('<'+'H'*n,b))

def cmp(a,b):
    aa,bb=utf16(a),utf16(b)
    return compare(aa,len(aa),bb,len(bb))

def check(s,where):
    s.encode('utf-8',errors='strict')
    if not s or s in ('.','..') or ':' in s or '/' in s or '\0' in s:raise ValueError(f'Unsupported HFS name: {where}')
    if len(s.encode('utf-16-le'))//2>255:raise ValueError(f'Name exceeds 255 UTF-16 code units: {where}')
    if hfs_normalized(s)!=s:raise ValueError(f'Name is not already HFS+ Unicode 3.2 decomposed: {where!r}')
    if cmp(s,'')==0:raise ValueError(f'Name consists only of HFS ignored characters: {where!r}')

def validate(stage,volume=None):
    stage=Path(stage).absolute();count=0;unicode_names=[]
    if volume is not None:check(volume,'volume name')
    for parent,dirs,files in os.walk(stage,followlinks=False):
        names=dirs+files
        for name in names:
            full=Path(parent)/name;rel=full.relative_to(stage).as_posix();check(name,rel)
            # Upstream traversal keeps 1024-byte path buffers.
            if len(os.fsencode(full))+2>1024:raise ValueError(f'Local path too long for upstream traversal: {rel}')
            if len(rel.encode('utf-8'))+2>1024:raise ValueError(f'HFS path too long for upstream traversal: {rel}')
            count+=1
            if not name.isascii():unicode_names.append(rel)
        ordered=sorted(names,key=functools.cmp_to_key(cmp))
        for a,b in zip(ordered,ordered[1:]):
            if cmp(a,b)==0:raise ValueError(f'HFS+ name collision: {parent}/{a!r} and {b!r}')
    return {'valid':True,'entries':count,'unicodePaths':unicode_names,'volumeName':volume,'normalization':'already HFS+ decomposed; no names changed','comparison':'upstream TN1150 FastUnicodeCompare','symlinksTraversed':False}

if __name__=='__main__':
    print(json.dumps(validate(sys.argv[1],sys.argv[2] if len(sys.argv)>2 else None),ensure_ascii=False,indent=2))
