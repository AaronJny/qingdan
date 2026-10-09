#!/usr/bin/env python3
"""Finalized Chinese-named app -> genuine UDIF/HFS+, without system mounts."""
import argparse,json,os,shutil,subprocess,tempfile
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--app',required=True);parser.add_argument('--output',required=True);parser.add_argument('--toolroot',required=True);parser.add_argument('--readme');args=parser.parse_args();app=Path(args.app).resolve();out=Path(args.output).resolve();tools=Path(args.toolroot).resolve()
if not app.is_dir()or app.is_symlink()or app.name!='青单.app':raise SystemExit('Use finalized genuine 青单.app')
if out.exists():raise SystemExit('Refusing to replace an existing DMG')
for p in app.rglob('*'):
 if any(len(part.encode('utf-16-be'))//2>255 or ':' in part for part in p.relative_to(app).parts):raise SystemExit('Unsupported HFS+ filename')
 if p.is_symlink()and p.readlink().is_absolute():raise SystemExit('Unexpected absolute link inside the app')
work=Path(tempfile.mkdtemp(prefix='qingdan-dmg-',dir=out.parent));stage=work/'stage';stage.mkdir();shutil.copytree(app,stage/app.name,symlinks=True);os.symlink('/Applications',stage/'Applications');raw=work/'image.hfs';logical=sum(p.stat().st_size for p in app.rglob('*')if p.is_file()and not p.is_symlink());capacity=max(64*1024*1024,((logical+128*1024*1024+1024*1024-1)//(1024*1024))*1024*1024)
if args.readme:shutil.copyfile(Path(args.readme).resolve(),stage/'START-HERE.txt')
with raw.open('wb')as f:f.truncate(capacity)
def run(argv):subprocess.run([str(x)for x in argv],check=True,env={**os.environ,'TZ':'UTC','LC_ALL':'C.UTF-8'})
# The reviewed UTF-8 tool must be paired with its HFS normalization/collision gate.
run(['python3',tools/'validate-stage-names.py',stage,'青单'])
run([tools/'root/usr/sbin/mkfs.hfsplus','-v','青单',raw]);run([tools/'build/hfs/hfsplus',raw,'addall',stage,'--symlinks=clone_link','--special-modes=no'])
# Only this created image's link permission bits are corrected. No host permissions.
run(['python3',Path(__file__).parent/'dmg/inspect-hfs.py',raw,stage,'--fix-link-modes']);run([tools/'root/usr/sbin/fsck.hfsplus','-fn',raw]);run([tools/'build/dmg/dmg','build',raw,out]);print(json.dumps({'dmg':str(out),'work':str(work),'stage':str(stage),'rawHfs':str(raw),'nativeMacMounted':False}))
