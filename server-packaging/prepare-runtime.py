#!/usr/bin/env python3
import argparse,hashlib,json,shutil,re
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('output');a=p.parse_args();src=Path(a.source).resolve();out=Path(a.output).resolve();assert not out.exists(),'Output must be fresh'
e=json.loads((src/'tests/standalone-evidence.json').read_text())
package=json.loads((src/'package.json').read_text())
assert re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?',package['version']),'A concrete release version is required'
assert all(e.get('checks',{}).get(key) for key in ['test','test:ui','test:server','typecheck','build']),'Run the complete source check first'
snapshot=hashlib.sha256(json.dumps(e['sha256'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
for name,h in e['sha256'].items():assert hashlib.sha256((src/name).read_bytes()).hexdigest()==h,name
artifacts={str(path.relative_to(src)):hashlib.sha256(path.read_bytes()).hexdigest() for path in (src/'dist').rglob('*') if path.is_file()}
assert artifacts and artifacts==e.get('artifact_sha256'),'Build outputs differ from the verified source check'
assert (src/'dist/server/main.mjs').is_file() and (src/'dist/server/users.mjs').is_file() and (src/'dist/client/index.html').is_file(),'Build the source first'
out.mkdir(parents=True);shutil.copytree(src/'dist',out/'dist');shutil.copytree(src/'drizzle',out/'drizzle')
for name in ['package.json','package-lock.json','README.md','AUTH.md','VERIFICATION.md']:shutil.copy2(src/name,out/name)
files={str(x.relative_to(out)):hashlib.sha256(x.read_bytes()).hexdigest() for x in out.rglob('*') if x.is_file()}
(out/'RUNTIME-MANIFEST.json').write_text(json.dumps({'product':'qingdan-standalone','version':package['version'],'source_snapshot_sha256':snapshot,'checks':e['checks'],'files_sha256':files},indent=2)+'\n');print(out)
