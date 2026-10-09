from pathlib import Path
import zipfile,hashlib,json,struct
root=Path(__file__).resolve().parent.parent;apk=root/'artifacts/Qingdan-0.1.0-android.apk';assets=root/'android/app/src/main/assets';matched=0;abis={};private=[]
with zipfile.ZipFile(apk)as z:
 assert z.testzip() is None
 for p in assets.rglob('*'):
  if p.is_file():
   name='assets/'+p.relative_to(assets).as_posix();assert z.read(name)==p.read_bytes(),name;matched+=1
 for name in z.namelist():
  if any(s in name.lower()for s in ['keystore','adbkey','.p12','.jks','password']):private.append(name)
  if name.startswith('lib/')and name.endswith('.so'):
   b=z.read(name);assert b[:4]==b'\x7fELF';elf64=b[4]==2;endian='<' if b[5]==1 else '>';phoff=struct.unpack_from(endian+('Q' if elf64 else 'I'),b,32 if elf64 else 28)[0];phentsize,phnum=struct.unpack_from(endian+'HH',b,54 if elf64 else 42);align=[]
   for i in range(phnum):
    off=phoff+i*phentsize;p_type=struct.unpack_from(endian+'I',b,off)[0]
    if p_type==1:align.append(struct.unpack_from(endian+('Q' if elf64 else 'I'),b,off+(48 if elf64 else 28))[0])
   assert all(v>=16384 for v in align),name;abis[name.split('/')[1]]={'jni':name,'elf_class':64 if elf64 else 32,'load_alignment':align,'sha256':hashlib.sha256(b).hexdigest()}
 assert not private,private
 for name in z.namelist():
  if name.startswith('assets/web/assets/')and name.endswith('.js'):
   assert b'node:sqlite' not in z.read(name),name
assert set(abis)=={'arm64-v8a','armeabi-v7a','x86','x86_64'}
report={'apk':apk.name,'bytes':apk.stat().st_size,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'apk_assets_matched_current_source':matched,'crc_all_entries_passed':True,'abis':abis,'no_private_key_files':True,'no_node_sqlite_dependency_in_bundled_js':True}
(root/'artifacts/APK-INDEPENDENT-VERIFICATION.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
