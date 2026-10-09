#!/usr/bin/env python3
"""Validate concrete resource hashes/symlink targets/nested cdhashes, not Apple rules."""
import hashlib,json,plistlib,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve();structural=json.loads(Path(sys.argv[2]).read_text());mach={x['path']:x for x in structural['machOFiles']};checked=[];errors=[];unsupported=[]
def nested_executable(p):
 if p.suffix=='.app':
  info=plistlib.loads((p/'Contents/Info.plist').read_bytes());return p/'Contents/MacOS'/info['CFBundleExecutable']
 if p.suffix=='.framework':
  info=plistlib.loads((p/'Versions/A/Resources/Info.plist').read_bytes());return p/'Versions/A'/info['CFBundleExecutable']
 return p
for seal in sorted(root.rglob('CodeResources')):
 if seal.is_symlink():continue
 base=seal.parent.parent;resource=plistlib.loads(seal.read_bytes());counts={'sha1':0,'sha256':0,'symlink':0,'cdhash':0}
 for section in ('files','files2'):
  for relative,value in resource.get(section,{}).items():
   p=base/relative
   if relative.startswith('/') or '..' in Path(relative).parts:raise ValueError('Unsafe resource seal path')
   if not p.exists() and not p.is_symlink():
    if isinstance(value,dict)and value.get('optional'):continue
    errors.append(str(p.relative_to(root))+':missing');continue
   if isinstance(value,bytes):value={'hash':value}
   for key,expected in value.items():
    if key in ('optional','requirement'):continue
    try:
     if key in ('hash','hash2'):
      algorithm='sha1'if key=='hash'else'sha256';actual=hashlib.new(algorithm,p.read_bytes()).digest();counts[algorithm]+=1
     elif key=='symlink':actual=p.readlink().as_posix();counts['symlink']+=1
     elif key=='cdhash':
      binary=nested_executable(p);data=mach[str(binary.relative_to(root))];actuals=[bytes.fromhex(d['cdhash'])for d in data['codeDirectories']];counts['cdhash']+=1
      if expected not in actuals:errors.append(str(p.relative_to(root))+':cdhash')
      continue
     else:unsupported.append(str(p.relative_to(root))+':'+key);continue
     if actual!=expected:errors.append(str(p.relative_to(root))+':'+key)
    except Exception as e:errors.append(str(p.relative_to(root))+':'+key+':'+type(e).__name__)
 checked.append({'seal':str(seal.relative_to(root)),'counts':counts,'ruleKeys':list(resource.get('rules2',{}))})
result={'structuralInspectionOnly':True,'nativeMacVerified':False,'seals':checked,'errors':errors,'unsupportedEntries':unsupported,'note':'Checks concrete entries only; does not validate all Apple resource-rule/requirement semantics or establish Gatekeeper acceptance.'};print(json.dumps(result,indent=2))
if errors or unsupported:sys.exit(1)
