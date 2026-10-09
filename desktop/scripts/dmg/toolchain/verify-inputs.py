"""Check all pinned bytes plus Debian keyring -> Release -> index -> package."""
from pathlib import Path
import hashlib,json,lzma,subprocess
r=Path(__file__).resolve().parent
m=json.loads((r/'provenance.json').read_text())
for item in m['downloadInputs']:
 p=r/item['file'];assert hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256'],str(p)
gnupg=r/'gnupg';gnupg.mkdir(exist_ok=True);gnupg.chmod(0o700)
with (r/'logs/debian-release-signature.txt').open('w') as log:
 subprocess.run(['gpg','--homedir',str(gnupg),'--batch','--no-default-keyring','--keyring','/usr/share/keyrings/debian-archive-keyring.gpg','--status-fd','1','--verify',str(r/'downloads/trixie.InRelease')],stdout=log,stderr=subprocess.STDOUT,check=True)
release=(r/'downloads/trixie.InRelease').read_text();packages={}
for component in ['main','non-free']:
 p=r/f'downloads/trixie-{component}-Packages.xz'
 line=next(s for s in release.split('SHA256:\n')[1].split('\nSHA512:')[0].splitlines() if s.split()[-1:]==[f'{component}/binary-amd64/Packages.xz'])
 assert hashlib.sha256(p.read_bytes()).hexdigest()==line.split()[0]
 for stanza in lzma.decompress(p.read_bytes()).decode().split('\n\n'):
  d=dict(s.split(': ',1) for s in stanza.splitlines() if ': ' in s and not s.startswith(' '))
  if 'Package' in d:packages[d['Package']]=d
for expected in m['debianPackages']:
 actual=packages[expected['Package']]
 for key in ['Version','Architecture','Filename','Size','SHA256']:assert expected[key]==actual[key],(expected['Package'],key)
print('Verified official Debian signatures, both package indexes, all 9 pinned packages, and Mozilla archive SHA256.')
