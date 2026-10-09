from pathlib import Path
import os
r=Path(__file__).resolve().parent/'fixture/stage'
files={
 '青单.app/Contents/MacOS/青单':(b'#!/bin/sh\nprintf "fixture\\n"\n',0o755),
 '青单.app/Contents/Resources/中文说明.txt':('青单 Unicode catalog fixture\n'.encode(),0o644),
 '青单.app/Contents/Frameworks/Demo.framework/Versions/A/Demo':(b'framework binary fixture\n',0o755),
 'ASCII-Directory/readme.txt':(b'ASCII bytes\n',0o644),
}
for name,(data,mode) in files.items():
 p=r/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);p.chmod(mode)
for name,target in {
 'Applications':'/Applications',
 '青单.app/Contents/Resources/说明链接':'中文说明.txt',
 '青单.app/Contents/Frameworks/Demo.framework/Versions/Current':'A',
 '青单.app/Contents/Frameworks/Demo.framework/Demo':'Versions/Current/Demo',
}.items():
 p=r/name
 if p.is_symlink():assert os.readlink(p)==target
 else:p.symlink_to(target)
for base,dirs,files in os.walk(r,followlinks=False):
 Path(base).chmod(0o755)
