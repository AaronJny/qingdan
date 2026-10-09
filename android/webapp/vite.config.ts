import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({root:'.',plugins:[react()],resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},build:{outDir:'dist/client',emptyOutDir:true,target:'es2022',sourcemap:false}});
