from pathlib import Path
import subprocess,json,os
r=Path(__file__).parent
exe=r/'unicode-codec-test'
tests=[]
def run(mode,value):
 return subprocess.run([bytes(exe),mode.encode(),value],capture_output=True,env={**os.environ,'ASAN_OPTIONS':'detect_leaks=0'})
for s in ['', 'ascii.app','青单.app','青单','中文说明.txt','e\u0301.txt','😀.txt','\U0010ffff','a'*255,'青'*255,'😀'*127+'a']:
 q=run('encode',s.encode())
 assert q.returncode==0,(s,q.stderr)
 lines=q.stdout.decode().splitlines()
 expected=s.encode('utf-16-be')
 assert lines==[str(len(expected)//2)+':'+expected.hex(),s,s],(s,lines)
 tests.append({'case':'valid UTF-8 roundtrip','codeUnits':len(expected)//2,'value':s if len(s)<30 else s[:5]+'…','passed':True})
for value in [b'\x80',b'\xc0\x80',b'\xc1\xbf',b'\xe0\x80\x80',b'\xed\xa0\x80',b'\xf0\x80\x80\x80',b'\xf4\x90\x80\x80',b'\xf5\x80\x80\x80',b'\xe9',b'\xe9\x9d',b'\xe9x',b'\xff',b'a'*256,('青'*256).encode(),('😀'*128).encode()]:
 q=run('encode',value)
 assert q.returncode==1,(value,q.returncode,q.stderr)
 assert b'ERROR: AddressSanitizer' not in q.stderr and b'runtime error:' not in q.stderr,q.stderr
 tests.append({'case':'invalid or overlong UTF-8 rejection','inputHex':value.hex() if len(value)<20 else value[:6].hex()+'…','passed':True})
for value in [b'd800',b'dfff',b'd8000061',b'd800d800']:
 q=run('decode',value)
 assert q.returncode==1,(value,q.returncode,q.stderr)
 assert b'ERROR: AddressSanitizer' not in q.stderr and b'runtime error:' not in q.stderr,q.stderr
 tests.append({'case':'unpaired UTF-16 surrogate rejection','inputHex':value.decode(),'passed':True})
q=run('decode',b'97525355')
assert q.returncode==0 and q.stdout=='青单\n'.encode()
print(json.dumps({'sanitizers':['AddressSanitizer','UndefinedBehaviorSanitizer'],'passedCases':len(tests)+1,'tests':tests},ensure_ascii=False,indent=2))
