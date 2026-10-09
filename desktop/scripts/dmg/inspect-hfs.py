#!/usr/bin/env python3
"""Independent minimal HFS+ catalog/data-fork check for own generated plain images."""
import hashlib,json,os,stat,struct,sys
from pathlib import Path
image=Path(sys.argv[1]);stage=Path(sys.argv[2]);fix='--fix-link-modes' in sys.argv[3:];data=bytearray(image.read_bytes()) if fix else image.read_bytes();header=data[1024:1536]
def u16(b,o):return struct.unpack_from('>H',b,o)[0]
def u32(b,o):return struct.unpack_from('>I',b,o)[0]
def u64(b,o):return struct.unpack_from('>Q',b,o)[0]
assert header[:2]in(b'H+',b'HX');block=u32(header,40)
def fork_bytes(fork):
 size=u64(fork,0);chunks=[]
 for i in range(8):
  start,count=u32(fork,16+i*8),u32(fork,20+i*8)
  if count:chunks.append(data[start*block:(start+count)*block])
 value=b''.join(chunks);assert len(value)>=size,'Unexpected overflow extent; refuse incomplete check';return value[:size]
catalog=fork_bytes(header[272:352]);node_size=u16(catalog,14+18);first_leaf=u32(catalog,14+10);node_id=first_leaf;entries=[];seen=set()
while node_id:
 assert node_id not in seen;seen.add(node_id);node=catalog[node_id*node_size:(node_id+1)*node_size];assert node[8]==255
 for i in range(u16(node,10)):
  offset=u16(node,node_size-2*(i+1));key_len=u16(node,offset);parent=u32(node,offset+2);length=u16(node,offset+6);raw_name=node[offset+8:offset+8+length*2];name=bytes(raw_name).decode('utf-16-be');record=node[offset+2+key_len:];kind=u16(record,0)
  if kind in(1,2):entries.append({'id':u32(record,8),'parent':parent,'name':name,'utf16Hex':raw_name.hex(),'mode':u16(record,42),'kind':'directory'if kind==1 else'file','payload':fork_bytes(record[88:168])if kind==2 else None,'catalogModeOffset':node_id*node_size+offset+2+key_len+42})
 node_id=u32(node,0)
by_id={r['id']:r for r in entries}
mode_offsets={}
def relative(entry):
 if entry['id']==2:return''
 assert entry['parent']in by_id;prefix=relative(by_id[entry['parent']]);return(prefix+'/'if prefix else'')+entry['name']
actual={}
for r in entries:
 name=relative(r)
 if not name:continue
 mode=r['mode'];record={'mode':mode&0o777,'utf16Name':r['name'],'utf16Hex':r['utf16Hex']}
 if stat.S_ISLNK(mode):record.update(kind='symlink',target=r['payload'].decode())
 elif r['kind']=='file':record.update(kind='file',bytes=len(r['payload']),sha256=hashlib.sha256(r['payload']).hexdigest())
 else:record.update(kind='directory')
 assert name not in actual,('Duplicate catalog path',name)
 actual[name]=record;mode_offsets[name]=r['catalogModeOffset']
expected={}
for p in sorted(stage.rglob('*')):
 name=p.relative_to(stage).as_posix();s=p.lstat();record={'mode':s.st_mode&0o777}
 if p.is_symlink():record.update(kind='symlink',target=os.readlink(p))
 elif p.is_file():record.update(kind='file',bytes=s.st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
 elif p.is_dir():record.update(kind='directory')
 expected[name]=record
if fix:
 fork=header[272:352]
 def physical(logical):
  for i in range(8):
   start,count=u32(fork,16+i*8),u32(fork,20+i*8);length=count*block
   if logical<length:return start*block+logical
   logical-=length
  raise ValueError('Catalog offset outside known extents')
 for name,r in expected.items():
  if r['kind']=='symlink' and name in actual and actual[name]['kind']=='symlink':
   offset=physical(mode_offsets[name]);original=u16(data,offset);struct.pack_into('>H',data,offset,(original&0xf000)|r['mode']);actual[name]['mode']=r['mode']
 image.write_bytes(data)
for name,r in expected.items():
 assert name in actual,('Missing or incorrectly Unicode-encoded catalog name',name)
 for k,value in r.items():assert actual[name][k]==value,(name,k,actual[name].get(k),value)
report={'volumeName':by_id[2]['name'],'volumeNameUtf16Hex':by_id[2]['utf16Hex'],'hfsSignature':header[:2].decode(),'allocationBlockSize':block,'catalogLeafNodes':len(seen),'verifiedStageEntries':len(expected),'symlinks':sum(r['kind']=='symlink'for r in expected.values()),'allBytesModesTargetsMatch':True,'independentUtf16CatalogVerified':True,'unexpectedCatalogEntries':sorted(set(actual)-set(expected)),'entries':actual,'nativeMacMounted':False};print(json.dumps(report,indent=2))
