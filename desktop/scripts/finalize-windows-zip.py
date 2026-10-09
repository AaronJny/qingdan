#!/usr/bin/env python3
"""Add only the approved local instructions to a distinct ZIP; preserve original entries."""
import argparse,shutil,zipfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('output');p.add_argument('readme');a=p.parse_args();source=Path(a.input).resolve();output=Path(a.output).resolve();readme=Path(a.readme).resolve()
if output.exists()or source==output:raise SystemExit('Refusing to replace an existing archive')
with zipfile.ZipFile(source)as z:
 if z.testzip()is not None or 'START-HERE.txt'in z.namelist():raise SystemExit('Input failed CRC or already contains instructions')
output.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,output)
with zipfile.ZipFile(output,'a',compression=zipfile.ZIP_DEFLATED,compresslevel=9)as z:z.writestr('START-HERE.txt',readme.read_bytes())
with zipfile.ZipFile(output)as z:
 if z.testzip()is not None:raise SystemExit('Final ZIP CRC failed')
