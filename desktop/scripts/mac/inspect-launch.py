#!/usr/bin/env python3
"""Resolve the literal helper paths used by Electron 44.6.0 (no macOS execution)."""
import argparse, json, plistlib, stat, sys
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('bundle');parser.add_argument('--expect',choices=('pass','fail'),default='pass')
args=parser.parse_args();bundle=Path(args.bundle).resolve();contents=bundle/'Contents'
info=plistlib.loads((contents/'Info.plist').read_bytes());names=['Electron',info['CFBundleName']]
suffixes=['',' (GPU)',' (Plugin)',' (Renderer)'];candidates=[]
for name in dict.fromkeys(names):
 group={'name':name,'helpers':[]}
 for suffix in suffixes:
  helper=f'{name} Helper{suffix}';base=contents/'Frameworks'/f'{helper}.app';binary=base/'Contents/MacOS'/helper;meta=base/'Contents/Info.plist'
  exists=binary.is_file() and not binary.is_symlink();executable=bool(exists and binary.stat().st_mode&0o111)
  values=plistlib.loads(meta.read_bytes()) if meta.is_file() else {}
  group['helpers'].append({'path':str(binary.relative_to(bundle)),'exists':exists,'executable':executable,'metadataMatches':values.get('CFBundleExecutable')==helper,'displayName':values.get('CFBundleDisplayName'),'bundleID':values.get('CFBundleIdentifier')})
 group['complete']=all(h['exists']and h['executable']and h['metadataMatches']for h in group['helpers']);candidates.append(group)
# The actual startup method checks the base helper first, then Chromium derives
# the specialized siblings. Report and require the complete family, not just base.
selected=next((c for c in candidates if c['helpers'][0]['exists']),None)
passed=bool(selected and selected['complete'])
report={'bundle':str(bundle),'main':{k:info.get(k)for k in ['CFBundleName','CFBundleDisplayName','CFBundleExecutable','CFBundleIdentifier','CFBundleVersion']},'lookupOrder':candidates,'selectedPrefix':selected['name']if selected else None,'helperResolutionPass':passed,'nativeMacLaunched':False,'reference':'https://github.com/electron/electron/blob/v44.6.0/shell/app/electron_main_delegate_mac.mm#L59-L69'}
print(json.dumps(report,ensure_ascii=False,indent=2))
if passed!=(args.expect=='pass'):sys.exit(1)
