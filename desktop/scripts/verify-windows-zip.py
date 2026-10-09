#!/usr/bin/env python3
"""Read-only CRC, every file byte/hash, and PE architecture checks; no Windows launch."""
import argparse,hashlib,json,struct,zipfile
from pathlib import Path,PurePosixPath
p=argparse.ArgumentParser();p.add_argument('zip');p.add_argument('unpacked');p.add_argument('report');p.add_argument('--readme');a=p.parse_args();archive=Path(a.zip);root=Path(a.unpacked)
sha=lambda data:hashlib.sha256(data).hexdigest()
expected={x.relative_to(root).as_posix():x for x in root.rglob('*')if x.is_file()and not x.is_symlink()}
if a.readme:expected['START-HERE.txt']=Path(a.readme)
records=[]
with zipfile.ZipFile(archive)as z:
 assert z.testzip()is None,'CRC failure'
 names=[x.filename for x in z.infolist()if not x.is_dir()]
 assert len(names)==len(set(names)),'duplicate archive path'
 assert set(names)==set(expected),'missing/extra packaged file'
 for n in names:
  pp=PurePosixPath(n);assert not pp.is_absolute()and '..'not in pp.parts and '\\'not in n and ':'not in n,'unsafe path'
  data=z.read(n);original=expected[n].read_bytes();assert data==original,n
  records.append({'path':n,'bytes':len(data),'sha256':sha(data)})
exe=(root/'Qingdan.exe').read_bytes();assert exe[:2]==b'MZ';pe=struct.unpack_from('<I',exe,0x3c)[0];assert exe[pe:pe+4]==b'PE\0\0';machine=struct.unpack_from('<H',exe,pe+4)[0];assert machine==0x8664;optional=pe+24;assert struct.unpack_from('<H',exe,optional)[0]==0x20b
cert_offset,cert_bytes=struct.unpack_from('<II',exe,optional+112+4*8)
report={'archiveBytes':archive.stat().st_size,'archiveSha256':sha(archive.read_bytes()),'allFilesCrcAndBytesMatched':True,'files':records,'peMachine':'amd64','peCertificateTableBytes':cert_bytes,'nativeWindowsLaunchTested':False}
Path(a.report).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k!='files'},indent=2))
