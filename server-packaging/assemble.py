#!/usr/bin/env python3
"""Assemble a fresh server directory using a compiled runtime and verified official Node archives."""
import argparse,hashlib,json,shutil,tarfile,re
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--app',required=True);inputs=p.add_mutually_exclusive_group(required=True);inputs.add_argument('--nodes');inputs.add_argument('--verified-runtime');p.add_argument('--output',required=True);a=p.parse_args();source=Path(__file__).resolve().parent;app=Path(a.app).resolve();nodes=Path(a.nodes).resolve() if a.nodes else None;prior=Path(a.verified_runtime).resolve() if a.verified_runtime else None;out=Path(a.output).resolve()
if out.exists():raise RuntimeError('Output must be a fresh directory')
m=json.loads((app/'RUNTIME-MANIFEST.json').read_text())
assert re.fullmatch(r'[a-f0-9]{64}',m.get('source_snapshot_sha256','')),'A verified source snapshot is required'
assert m['version']==json.loads((app/'package.json').read_text())['version'],'Runtime version mismatch'
for name,h in m['files_sha256'].items():assert hashlib.sha256((app/name).read_bytes()).hexdigest()==h,name
assert (app/'node_modules/@js-temporal/polyfill/package.json').is_file(),'Install the locked production dependencies first'
for path in app.rglob('*'):
 if path.is_file():assert not {'data','.git'}.intersection(path.relative_to(app).parts),'Do not bundle user data'
out.mkdir(parents=True)
for f in source.iterdir():
 if f.suffix in {'.sh','.command'}:shutil.copy2(f,out/f.name)
shutil.copytree(source/'launcher',out/'launcher');shutil.copy2(source/'README-运行.txt',out/'先读我.txt');shutil.copytree(app,out/'app',ignore=shutil.ignore_patterns('data','.git'))
expected={'linux-x64':'14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647','darwin-arm64':'3f1cf157479c1480352083105e13faf9d008ede98e7e157746b6df940d197b94'}
expected_binary={'linux-x64':'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12','darwin-arm64':'27db838bb204ef7c21df2931f5656e4c8fb32e6e947f363a402b49714d32b5b1'}
expected_license='148eacf7863ef4329224a29398623077200a27194aa075569faf4a0a85566ca5'
records=[]
if nodes:
 checks={x.split()[1]:x.split()[0] for x in (nodes/'SHASUMS256.txt').read_text().splitlines()}
 for arch,h in expected.items():
  name=f'node-v24.19.0-{arch}.tar.xz';archive=nodes/name;assert hashlib.sha256(archive.read_bytes()).hexdigest()==h==checks[name];target=out/'runtime'/arch;target.mkdir(parents=True)
  with tarfile.open(archive,'r:xz') as t:
   for rel,dest in [('bin/node','node'),('LICENSE','LICENSE')]:
    (target/dest).write_bytes(t.extractfile(name[:-7]+'/'+rel).read())
  (target/'node').chmod(0o755)
  assert hashlib.sha256((target/'node').read_bytes()).hexdigest()==expected_binary[arch]
  assert hashlib.sha256((target/'LICENSE').read_bytes()).hexdigest()==expected_license
  records.append({'arch':arch,'filename':name,'bytes':archive.stat().st_size,'sha256':h,'url':'https://nodejs.org/dist/v24.19.0/'+name,'node_sha256':expected_binary[arch],'node_bytes':(target/'node').stat().st_size})
 shutil.copy2(nodes/'SHASUMS256.txt',out/'runtime/SHASUMS256.txt')
else:
 # Reuse only exact official bytes previously validated against these archives.
 # This option accepts no arbitrary executable or publisher identity.
 checks={x.split()[1]:x.split()[0] for x in (prior/'SHASUMS256.txt').read_text().splitlines()}
 previous=json.loads((prior/'NODE-RUNTIMES.json').read_text())
 for arch,h in expected.items():
  name=f'node-v24.19.0-{arch}.tar.xz';record=next(x for x in previous if x['arch']==arch)
  assert record['filename']==name and record['sha256']==h==checks[name]
  assert record['url']=='https://nodejs.org/dist/v24.19.0/'+name
  assert hashlib.sha256((prior/arch/'node').read_bytes()).hexdigest()==expected_binary[arch]==record['node_sha256']
  assert hashlib.sha256((prior/arch/'LICENSE').read_bytes()).hexdigest()==expected_license
  target=out/'runtime'/arch;target.mkdir(parents=True)
  for item in ['node','LICENSE']:shutil.copy2(prior/arch/item,target/item)
  (target/'node').chmod(0o755);records.append(record)
 shutil.copy2(prior/'SHASUMS256.txt',out/'runtime/SHASUMS256.txt')
(out/'runtime/NODE-RUNTIMES.json').write_text(json.dumps(records,indent=2)+'\n')
files={str(x.relative_to(out)):hashlib.sha256(x.read_bytes()).hexdigest() for x in out.rglob('*') if x.is_file()}
(out/'SERVER-MANIFEST.json').write_text(json.dumps({'product':'qingdan-server-web','version':m['version'],'application_source_snapshot_sha256':m['source_snapshot_sha256'],'platforms':['linux-x64-glibc','darwin-arm64'],'runtime':'official Node.js 24.19.0','bundled_dependencies':'package-lock production-only installation','files_sha256':files,'boundaries':['Final archive must be independently extracted and tested with synthetic local/accounts data.','Darwin official checksum and executable format verified; native Mac execution pending.','No real credentials or external deployment configured.']},ensure_ascii=False,indent=2)+'\n')
print(out)
