import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { bundledLicenses } from './scripts/license-plugin.mjs';
export default defineConfig({root:'.',plugins:[react(),bundledLicenses()],resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},build:{outDir:'dist/client',emptyOutDir:true,target:'es2022',sourcemap:false}});
