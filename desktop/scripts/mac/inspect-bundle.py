#!/usr/bin/env python3
"""Linux structural hash evidence only. Not Apple codesign/Gatekeeper verification."""
import hashlib,json,plistlib,struct,sys
from pathlib import Path
bundle=Path(sys.argv[1]).resolve()
records=[]
def be(b,o): return struct.unpack_from('>I',b,o)[0]
def le(b,o): return struct.unpack_from('<I',b,o)[0]
def owner_paths(binary):
 for parent in binary.parents:
  if parent==bundle.parent:break
  if parent.suffix=='.app':return parent/'Contents/Info.plist',parent/'Contents/_CodeSignature/CodeResources'
  if parent.suffix=='.framework':return parent/'Versions/A/Resources/Info.plist',parent/'Versions/A/_CodeSignature/CodeResources'
 return None,None
for p in sorted(bundle.rglob('*')):
 if p.is_symlink() or not p.is_file():continue
 with p.open('rb')as f:magic=f.read(4)
 if magic!=b'\xcf\xfa\xed\xfe':continue
 data=p.read_bytes();sig=None;offset=32
 for _ in range(le(data,16)):
  command,size=le(data,offset),le(data,offset+4)
  assert size>=8 and offset+size<=len(data)
  if command==0x1d:sig=(le(data,offset+8),le(data,offset+12))
  offset+=size
 record={'path':str(p.relative_to(bundle)),'sha256':hashlib.sha256(data).hexdigest(),'signed':bool(sig)}
 if not sig:records.append(record);continue
 blob=data[sig[0]:sig[0]+sig[1]];assert be(blob,0)==0xfade0cc0;types={}
 for i in range(be(blob,8)):
  typ,start=be(blob,12+i*8),be(blob,16+i*8);length=be(blob,start+4);assert start+length<=len(blob);types[typ]=blob[start:start+length]
 record.update(signatureBytes=sig[1],xmlEntitlements=types.get(5,b'')[8:].decode('utf8') or None,derEntitlementsSha256=hashlib.sha256(types[7]).hexdigest()if 7 in types else None,cmsWrapperPresent=0x10000 in types,cmsPayloadBytes=max(0,len(types.get(0x10000,b''))-8),codeDirectories=[])
 info,resources=owner_paths(p)
 for typ,directory in types.items():
  if be(directory,0)!=0xfade0c02:continue
  ho,ss,cs,limit=be(directory,16),be(directory,24),be(directory,28),be(directory,32);hs,ht,ps=directory[36],directory[37],directory[39]
  assert ht in(1,2,3,4);algorithm={1:'sha1',2:'sha256',3:'sha256',4:'sha384'}[ht];page=2**ps if ps else limit
  digest=lambda b:hashlib.new(algorithm,b).digest()[:hs]
  mismatches=[i for i in range(cs)if digest(data[i*page:min((i+1)*page,limit)])!=directory[ho+i*hs:ho+(i+1)*hs]]
  specials=[]
  for slot in range(1,ss+1):
   expected=directory[ho-slot*hs:ho-(slot-1)*hs]
   if not any(expected):continue
   value=None;source=None
   if slot==1 and info and info.exists():value=info.read_bytes();source=str(info.relative_to(bundle))
   elif slot==3 and resources and resources.exists():value=resources.read_bytes();source=str(resources.relative_to(bundle))
   elif slot in types:value=types[slot];source='signature blob slot'+str(slot)
   specials.append({'slot':slot,'source':source,'hashMatches':digest(value)==expected if value is not None else None})
  io=be(directory,20);identifier=directory[io:].split(b'\0',1)[0].decode('utf8')
  record['codeDirectories'].append({'slotType':typ,'flags':be(directory,12),'flagsHex':hex(be(directory,12)),'identifier':identifier,'cdhash':hashlib.new(algorithm,directory).digest()[:20].hex(),'pages':cs,'pageSize':page,'mismatchedPages':mismatches,'specialSlots':specials})
 records.append(record)
report={'bundle':str(bundle),'structuralInspectionOnly':True,'nativeMacVerified':False,'machOFiles':records,'summary':{'machOCount':len(records),'signedMachOCount':sum(r['signed']for r in records),'pages':sum(d['pages']for r in records for d in r.get('codeDirectories',[])),'mismatchedPages':sum(len(d['mismatchedPages'])for r in records for d in r.get('codeDirectories',[])),'specialSlotMismatches':sum(s['hashMatches'] is False for r in records for d in r.get('codeDirectories',[])for s in d['specialSlots']),'unverifiedSpecialSlots':sum(s['hashMatches']is None for r in records for d in r.get('codeDirectories',[])for s in d['specialSlots'])}}
print(json.dumps(report,indent=2))
