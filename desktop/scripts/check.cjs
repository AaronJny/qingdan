'use strict';const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');for(const folder of ['src','scripts','test'])for(const name of fs.readdirSync(path.join(root,folder)))if(/\.(?:cjs|mjs|js)$/.test(name)){const result=spawnSync(process.execPath,['--check',path.join(root,folder,name)],{stdio:'inherit'});if(result.status)process.exit(result.status)}
require('../src/policy.cjs').validateDefaults(require('../src/defaults.json'));
for(const name of fs.readdirSync(path.join(root,'src'))){const text=fs.readFileSync(path.join(root,'src',name),'utf8');if(/chatgpt\.site|auth\.openai\.com|signin-with-chatgpt|qingdan-cloud-v1/.test(text))throw Error('Unexpected old platform runtime binding')}
console.log('v3 syntax/defaults/no-platform checks pass');
