import { build } from 'esbuild';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function buildServer(outdir = 'dist/server') {
  return build({
    entryPoints: {
      main: 'server/main.ts',
      users: 'scripts/users.ts',
      'calendar-worker': 'lib/calendar-ics-worker.ts',
    },
    outdir, outExtension: { '.js': '.mjs' }, bundle: true,
    platform: 'node', target: 'node24', format: 'esm', packages: 'external', sourcemap: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await buildServer();
