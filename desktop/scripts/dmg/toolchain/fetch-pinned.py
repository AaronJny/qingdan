import json, pathlib, subprocess, hashlib, concurrent.futures
root=pathlib.Path(__file__).parent
manifest=json.loads((root/'provenance.json').read_text())['debianPackages']
packages={p['Filename']:p for p in manifest}
def get(p):
 dest=root/'downloads'/pathlib.Path(p['Filename']).name
 for base in ['https://deb.debian.org/debian/','https://snapshot.debian.org/archive/debian/20260925T181338Z/']:
  if not dest.exists():
   r=subprocess.run(['curl','-fsSL','--retry','2',base+p['Filename'],'-o',str(dest)])
   if r.returncode: continue
  actual=hashlib.sha256(dest.read_bytes()).hexdigest()
  if actual!=p['SHA256']: raise RuntimeError((dest,actual,p['SHA256']))
  print(dest.name,actual,flush=True)
  return p
 raise RuntimeError('Download failed: '+p['Filename'])
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool: results=list(pool.map(get,packages.values()))
for p in results: subprocess.run(['dpkg-deb','-x',str(root/'downloads'/pathlib.Path(p['Filename']).name),str(root/'root')],check=True)
(root/'downloads'/'debian-pinned-packages.json').write_text(json.dumps(results,indent=2)+'\n')
