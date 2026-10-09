import{build}from'../webapp/node_modules/vite/dist/node/index.js';import config from'../webapp/vite.android.config.ts';import{resolve}from'node:path';
await build({...config,configFile:false,publicDir:false,build:{outDir:resolve('artifacts/native-api-test'),emptyOutDir:true,target:'es2022',lib:{entry:resolve('webapp/native/dispatch.ts'),formats:['es'],fileName:'dispatch'},minify:false}});
