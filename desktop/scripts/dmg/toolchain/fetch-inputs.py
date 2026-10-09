"""Obtain exact pinned artifacts from official upstreams; never execute/install."""
import hashlib,json,subprocess
from pathlib import Path
r=Path(__file__).parent
for item in json.loads((r/'provenance.json').read_text())['downloadInputs']:
 p=r/item['file'];p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists() and hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256']:continue
 for key in ['url','snapshotUrl']:
  if key not in item:continue
  tmp=p.with_suffix(p.suffix+'.partial')
  result=subprocess.run(['curl','-fsSL','--retry','2',item[key],'-o',str(tmp)])
  if result.returncode==0 and hashlib.sha256(tmp.read_bytes()).hexdigest()==item['sha256']:
   tmp.replace(p);break
 else:raise RuntimeError('No official source supplied matching pinned bytes: '+item['file'])
 print(item['file'],item['sha256'],flush=True)
