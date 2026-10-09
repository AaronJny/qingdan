#!/usr/bin/env python3
import argparse,hashlib,json,os,zipfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('directory');p.add_argument('zip');a=p.parse_args();root=Path(a.directory).resolve();out=Path(a.zip).resolve();assert not out.exists(),'Do not overwrite prior artifacts'
m=json.loads((root/'SERVER-MANIFEST.json').read_text())
for name,h in m['files_sha256'].items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==h,name
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(root.rglob('*')):
  if f.is_file():z.write(f,'qingdan-server/'+str(f.relative_to(root)))
with zipfile.ZipFile(out) as z:
 assert z.testzip() is None
 for name in ['start.sh','start.command','stop.sh','init-admin.command','runtime/linux-x64/node','runtime/darwin-arm64/node']:assert z.getinfo('qingdan-server/'+name).external_attr>>16&0o111
print(json.dumps({'path':str(out),'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'source_commit':m['application_source_commit'],'files':len(m['files_sha256'])+1}))
